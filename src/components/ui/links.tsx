import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CopyButton } from './CopyButton'
import { formatType } from '@/lib/format'
import { truncateMiddle } from '@/lib/search'
import { mvrNameForPackageCached } from '@/lib/mvr'
import { useNetwork } from '@/context/useNetwork'

/**
 * The MVR name assigned to a package id (reverse-resolved, session-cached), or
 * `null`. Lets a type repr show `@ns/app::mod::Struct` in place of the raw
 * package id. `null` package → no lookup.
 */
function useMvrName(packageId: string | null): string | null {
  const { network } = useNetwork()
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    setName(null)
    if (!packageId) return
    let active = true
    mvrNameForPackageCached(network, packageId).then((n) => {
      if (active) setName(n)
    })
    return () => {
      active = false
    }
  }, [network, packageId])
  return name
}

/** Build a `?search=` href for the current location, preserving other params.
 * Drops `version` — a pinned object version belongs to the id being left, not
 * the new entity being navigated to. */
export function useSearchHref() {
  const [params] = useSearchParams()
  return (value: string) => {
    const next = new URLSearchParams(params)
    next.set('search', value)
    next.delete('version')
    return `?${next.toString()}`
  }
}

/** Build an href that pins the current object to a `version` (or clears the pin
 * when `null` → back to latest), preserving the active search id and network. */
export function useVersionHref() {
  const [params] = useSearchParams()
  return (version: number | null) => {
    const next = new URLSearchParams(params)
    if (version == null) next.delete('version')
    else next.set('version', String(version))
    return `?${next.toString()}`
  }
}

/** Link the full identifier text (used inline, e.g. inside JSON). */
export function EntityLink({ id }: { id: string }) {
  const searchHref = useSearchHref()
  return (
    <Link to={searchHref(id)} className="text-primary hover:underline" title={id}>
      {id}
    </Link>
  )
}

// An address, optionally trailed by `::module::name…` Move-path segments — as
// it appears in free text like an execution-error message.
const MOVE_PATH_OR_ADDRESS = /0x[0-9a-fA-F]{1,64}(?:::[A-Za-z_][A-Za-z0-9_]*)*/g

/**
 * Linkify any Move paths (`0x..::mod::fn`) and bare addresses found in plain
 * text — each to its own page — leaving the rest as text. Used for failure
 * messages so the offending function/package is clickable.
 */
export function linkifyMoveText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  MOVE_PATH_OR_ADDRESS.lastIndex = 0
  while ((m = MOVE_PATH_OR_ADDRESS.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<EntityLink key={m.index} id={m[0]} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** A truncated, copyable identifier that links to its own page. */
export function LinkedHash({ value }: { value: string }) {
  const searchHref = useSearchHref()
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        to={searchHref(value)}
        className="hash text-primary hover:underline"
        title={value}
      >
        {truncateMiddle(value)}
      </Link>
      <CopyButton value={value} label="Copy" />
    </span>
  )
}

/** A parsed Move type repr: a base (`pkg::mod::Name`, `vector`, or a primitive)
 * and its type arguments. Generics nest recursively. */
interface TypeNode {
  base: string
  args: TypeNode[]
}

/** Parse a type repr (`0x2::coin::Coin<0xab::usdc::USDC>`) into a `TypeNode`. */
function parseType(repr: string): TypeNode {
  const lt = repr.indexOf('<')
  if (lt === -1) return { base: repr.trim(), args: [] }
  const base = repr.slice(0, lt).trim()
  const inner = repr.slice(lt + 1, repr.lastIndexOf('>'))
  return { base, args: splitTypeArgs(inner).map(parseType) }
}

/** Split top-level comma-separated type args, respecting nested `<…>`. */
function splitTypeArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out.map((p) => p.trim()).filter(Boolean)
}

/**
 * Render a parsed type. The base struct links to its own page using *only* the
 * top-level tag (`pkg::mod::Name`, no generics) — type arguments don't help
 * navigate there. Each argument is still rendered as its own `TypeNodeView`, so
 * inner types remain individually clickable. Primitives / `vector` aren't links.
 */
function TypeNodeView({ node }: { node: TypeNode }) {
  const searchHref = useSearchHref()
  const sep = node.base.indexOf('::')
  const isStruct = sep !== -1
  // Reverse-resolve the base struct's package to its MVR name, and show
  // `@ns/app::mod::Struct` in place of the raw id when one exists.
  const mvrName = useMvrName(isStruct ? node.base.slice(0, sep) : null)
  const baseLabel =
    isStruct && mvrName ? mvrName + node.base.slice(sep) : formatType(node.base)
  return (
    <>
      {isStruct ? (
        <Link
          to={searchHref(node.base)}
          title={node.base}
          className="text-primary hover:underline"
        >
          {baseLabel}
        </Link>
      ) : (
        formatType(node.base)
      )}
      {node.args.length > 0 && (
        <>
          &lt;
          {node.args.map((arg, i) => (
            <Fragment key={i}>
              {i > 0 ? ', ' : ''}
              <TypeNodeView node={arg} />
            </Fragment>
          ))}
          &gt;
        </>
      )}
    </>
  )
}

/**
 * A Move type repr with addresses trimmed for display. The base struct links to
 * its own page (generics stripped from the target); type arguments are clickable
 * in their own right. `copy` adds a button that copies the full original type.
 */
export function TypeLink({ type, copy = false }: { type: string; copy?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="hash break-all">
        <TypeNodeView node={parseType(type)} />
      </span>
      {copy && <CopyButton value={type} label="Copy type" />}
    </span>
  )
}
