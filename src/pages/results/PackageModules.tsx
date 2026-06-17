import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileCode2, Loader2 } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useSearchHref } from '@/components/ui/links'
import { cn } from '@/lib/cn'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchModule, fetchAllModules, type PackageModuleInfo } from '@/lib/object'
import { escapeRegExp } from '@/lib/format'

/**
 * Package module browser: a left rail of module names and a source pane that
 * shows the selected module's bytecode disassembly (`sui move disassemble`
 * output — readable, not the original Move source). Selection is local state
 * (not URL-bound), seeded from a `addr::module` search path.
 */
export function PackageModules({
  packageId,
  modules,
  version,
  hasNextPage,
  defaultModule,
  highlightType,
}: {
  packageId: string
  modules: { name: string }[]
  version: number | null
  hasNextPage: boolean
  /** Module to open initially (e.g. from a `addr::module` search). */
  defaultModule?: string
  /** Struct/enum name to highlight in the open module's disassembly. */
  highlightType?: string
}) {
  const { network } = useNetwork()
  // Always load the full module set (with each module's datatype names) so the
  // rail lists every module and the filter can match struct/enum names — the
  // package object query only carries the first 50 module names.
  const all = useAsync(
    (signal) => fetchAllModules(network, packageId, signal),
    [network, packageId],
  )
  const mods = useMemo<PackageModuleInfo[]>(() => {
    const base =
      all.data ?? modules.map((m) => ({ name: m.name, datatypes: [] as string[] }))
    return [...base].sort((a, b) => a.name.localeCompare(b.name))
  }, [all.data, modules])
  const names = useMemo(() => mods.map((m) => m.name), [mods])

  // The module to open by default: the search-provided one if it exists, else
  // the first alphabetically.
  const initial = useMemo(
    () =>
      defaultModule && names.includes(defaultModule)
        ? defaultModule
        : (names[0] ?? null),
    [names, defaultModule],
  )

  // Selection lives in local state — switching modules is an in-page action,
  // not a navigation, so it doesn't touch the URL. A new navigation (different
  // package / default) resets the manual pick back to the default.
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setPicked(null), [initial])
  const selected = picked && names.includes(picked) ? picked : initial

  // Search: case-insensitive, accepts `addr::module::Struct` paths (address
  // segments dropped), and matches a module by its name OR any datatype name.
  const [filter, setFilter] = useState('')
  const tokens = useMemo(() => queryTokens(filter), [filter])
  const shown = useMemo(
    () =>
      tokens.length === 0
        ? mods.map((m) => m.name)
        : mods.filter((m) => moduleMatches(m, tokens)).map((m) => m.name),
    [tokens, mods],
  )

  const countSuffix = hasNextPage && !all.data ? '+' : ''

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
      <Panel>
        <PanelSection
          label="Modules"
          action={
            <span className="text-muted inline-flex items-center gap-1.5 font-mono text-xs">
              {all.loading && <Loader2 size={12} className="animate-spin" />}
              {names.length}
              {countSuffix} · v{version}
            </span>
          }
        >
          {names.length > 1 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="module or struct"
              spellCheck={false}
              aria-label="filter modules and structs"
              className="input mb-3 !py-1.5 !text-xs"
            />
          )}
          <ul className="max-h-[28rem] space-y-0.5 overflow-y-auto">
            {shown.map((name) => {
              const active = name === selected
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setPicked(name)}
                    className={cn(
                      'flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left font-mono text-xs transition-colors',
                      active
                        ? 'border-primary bg-surface-2 text-primary'
                        : 'border-transparent text-muted hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    <FileCode2 size={14} className="shrink-0" />
                    <span className="truncate">{name}</span>
                  </button>
                </li>
              )
            })}
            {shown.length === 0 && (
              <li className="text-muted px-2 py-1.5 font-mono text-xs">
                no match
              </li>
            )}
          </ul>
        </PanelSection>
      </Panel>

      {selected ? (
        <ModuleSource
          packageId={packageId}
          moduleName={selected}
          highlightType={highlightType}
        />
      ) : (
        <Panel>
          <PanelSection label="Disassembly">
            <EmptyState title="no modules">
              this package declares no modules.
            </EmptyState>
          </PanelSection>
        </Panel>
      )}
    </div>
  )
}

/** Tokenize a module search query: split on `::`/whitespace, lowercase, and
 * drop address-looking segments so `0x2::coin::Coin` → ['coin', 'coin']. */
function queryTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/::|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^0x[0-9a-f]*$/.test(s))
}

/** A module matches when any query token is a substring of its name or of one
 * of its datatype (struct/enum) names — case-insensitive. */
function moduleMatches(mod: PackageModuleInfo, tokens: string[]): boolean {
  const name = mod.name.toLowerCase()
  const types = mod.datatypes.map((d) => d.toLowerCase())
  return tokens.some((t) => name.includes(t) || types.some((d) => d.includes(t)))
}

/** One render row of disassembly: a plain source line, or a function whose
 * body folds away. */
type Row = { t: 'line'; i: number } | { t: 'fn'; decl: number; body: number[] }

/** Source pane: lazy-fetches and renders the selected module's disassembly.
 * Function bodies fold (collapsed by default); type references are clickable;
 * `highlightType`'s declaration block is highlighted and scrolled to. */
function ModuleSource({
  packageId,
  moduleName,
  highlightType,
}: {
  packageId: string
  moduleName: string
  highlightType?: string
}) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const { data, loading, error } = useAsync(
    (signal) => fetchModule(network, packageId, moduleName, signal),
    [network, packageId, moduleName],
  )

  const disassembly = data?.disassembly ?? null
  const lines = useMemo(
    () => (disassembly ? disassembly.split('\n') : []),
    [disassembly],
  )
  const rows = useMemo(() => buildRows(lines), [lines])
  // Matches the linkable tokens in a line: fully-qualified `addr::module[::Type]`
  // paths (the `use` imports) and references to this module's own datatypes.
  const linkRe = useMemo(() => linkRegex(lines), [lines])
  // The contiguous `struct/enum Name … { … }` block to highlight, if found.
  const range = useMemo(
    () => (highlightType ? declRange(lines, highlightType) : null),
    [lines, highlightType],
  )

  // Link target for a matched token: full paths get a `0x` and resolve as-is;
  // bare local datatypes resolve against this package + module.
  const hrefFor = (tok: string) =>
    searchHref(
      tok.includes('::')
        ? '0x' + tok.replace(/^0x/i, '')
        : `${packageId}::${moduleName}::${tok}`,
    )
  const render = (text: string) => linkifyLine(text, linkRe, hrefFor)

  // Bring the highlighted declaration to the top — vertical scroll only, so the
  // pane never jumps sideways. Manual scrollTop (not scrollIntoView) keeps the
  // horizontal position pinned at the start.
  const preRef = useRef<HTMLPreElement>(null)
  const markRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const pre = preRef.current
    const mark = markRef.current
    if (!pre || !mark || !range) return
    pre.scrollTop = Math.max(0, mark.offsetTop - 12)
  }, [range, disassembly])

  return (
    <Panel className="min-w-0">
      <PanelSection
        label={`module ${moduleName}`}
        action={
          <span className="flex items-center gap-3">
            {data?.fileFormatVersion != null && (
              <span className="text-muted font-mono text-xs">
                bytecode v{data.fileFormatVersion}
              </span>
            )}
            {disassembly && <CopyButton value={disassembly} label="Copy" />}
          </span>
        }
      >
        {loading ? (
          <SkeletonLines count={8} />
        ) : error ? (
          <EmptyState title="failed to load module">{error.message}</EmptyState>
        ) : disassembly ? (
          <pre
            ref={preRef}
            className="bg-bg/60 border-line relative max-h-[40rem] overflow-auto border py-4 font-mono text-xs leading-relaxed"
          >
            <code>
              {rows.map((row, k) => {
                if (row.t === 'fn') {
                  return (
                    <FoldableFn
                      key={k}
                      decl={lines[row.decl]}
                      body={row.body.map((b) => lines[b])}
                      render={render}
                    />
                  )
                }
                const i = row.i
                const hot = !!range && i >= range[0] && i <= range[1]
                return (
                  <span
                    key={k}
                    ref={range && i === range[0] ? markRef : undefined}
                    className={cn(
                      'block px-4',
                      hot &&
                        'bg-primary/10 shadow-[inset_3px_0_0_0_var(--primary)]',
                    )}
                  >
                    {render(lines[i])}
                  </span>
                )
              })}
            </code>
          </pre>
        ) : (
          <span className="text-muted text-sm">
            no disassembly available for this module.
          </span>
        )}
      </PanelSection>
    </Panel>
  )
}

/** A function whose body is hidden behind a toggle (collapsed by default). The
 * declaration line stays visible; clicking it expands the bytecode. Type
 * references in both stay clickable (their clicks don't toggle). */
function FoldableFn({
  decl,
  body,
  render,
}: {
  decl: string
  body: string[]
  render: (text: string) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-surface-2 block cursor-pointer px-4"
      >
        <span className="text-muted select-none">{open ? '▾ ' : '▸ '}</span>
        {render(decl)}
        {!open && <span className="text-muted"> … {'}'}</span>}
      </span>
      {open &&
        body.map((line, i) => (
          <span key={i} className="block px-4">
            {render(line)}
          </span>
        ))}
    </>
  )
}

/**
 * Render a disassembly line with its type references turned into links. `re` is
 * a global regex; we walk its matches and wrap each in a `Link`. Link clicks
 * stop propagation so they navigate without toggling an enclosing fold.
 */
function linkifyLine(
  text: string,
  re: RegExp,
  hrefFor: (tok: string) => string,
): ReactNode {
  if (!text) return ' '
  const out: ReactNode[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const tok = m[0]
    if (tok.length === 0) {
      re.lastIndex++
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <Link
        key={m.index}
        to={hrefFor(tok)}
        onClick={(e) => e.stopPropagation()}
        className="text-primary hover:underline"
      >
        {tok}
      </Link>,
    )
    last = m.index + tok.length
  }
  if (out.length === 0) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Build the linkable-token regex for a module: full `addr::module[::Type]`
 * paths plus this module's own datatype names. */
function linkRegex(lines: string[]): RegExp {
  const locals = localTypeNames(lines)
  // Longest names first so e.g. `PoolTokenExchangeRate` wins over `Pool`.
  const local = locals.length
    ? '\\b(?:' +
      locals
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|') +
      ')\\b'
    : ''
  // 0x-prefixed (any length) or a long bare hex run — long enough not to
  // collide with hex-spelled module names (`bag`, `dead`) in `mod::fn` calls.
  const full =
    '(?:0x[0-9a-fA-F]{1,64}|[0-9a-fA-F]{8,64})::[A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)?'
  return new RegExp([full, local].filter(Boolean).join('|'), 'g')
}

/** Names of datatypes declared in this module (its `struct`/`enum` lines). */
function localTypeNames(lines: string[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    const m = /^(?:struct|enum)\s+(\w+)/.exec(l)
    if (m) out.push(m[1])
  }
  return out
}

/**
 * Split disassembly into render rows, grouping each function with its body so
 * the body can fold. A function is a column-0 line ending in `{` that has a
 * parameter list `(` — disassembly has no `fun` keyword — and isn't a
 * struct/enum/module opener. Its body runs to the next column-0 `}`.
 */
function buildRows(lines: string[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    const opensFn =
      !!l &&
      !/^\s/.test(l) &&
      l.trimEnd().endsWith('{') &&
      l.includes('(') &&
      !l.startsWith('struct ') &&
      !l.startsWith('enum ') &&
      !l.startsWith('module ')
    if (opensFn) {
      let j = i + 1
      while (j < lines.length && !lines[j].startsWith('}')) j++
      const body: number[] = []
      for (let k = i + 1; k <= j && k < lines.length; k++) body.push(k)
      rows.push({ t: 'fn', decl: i, body })
      i = j + 1
    } else {
      rows.push({ t: 'line', i })
      i++
    }
  }
  return rows
}

/**
 * Locate a top-level `struct`/`enum Name` declaration and the line range of its
 * block. Declarations sit at column 0 and the closing brace is also at column 0
 * (`sui move disassemble` output), so the block runs to the next line starting
 * with `}`. Returns `null` when the type isn't declared in this module.
 */
function declRange(lines: string[], name: string): [number, number] | null {
  const re = new RegExp(`^(struct|enum)\\s+${escapeRegExp(name)}\\b`)
  const start = lines.findIndex((l) => re.test(l))
  if (start === -1) return null
  if (!lines[start].includes('{')) return [start, start]
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].startsWith('}')) return [start, j]
  }
  return [start, start]
}
