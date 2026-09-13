import { useState, type ReactNode } from 'react'
import { CopyButton } from './CopyButton'
import { linkifyAddresses } from './JsonBlock'
import { cn } from '@/lib/cn'
import { describeInstant } from '@/lib/format'

/**
 * A collapsible JSON tree viewer for Move object contents. Objects and arrays
 * fold/unfold per node; primitive values render inline with any on-chain
 * id/address linkified, and any field whose name contains `timestamp_ms` (the
 * Move convention for an epoch-ms instant — `Clock.timestamp_ms`,
 * `expiration_timestamp_ms`, …) highlighted with the UTC time in its tooltip. The body scrolls (so a huge
 * object doesn't run off the page) and `expand all` / `collapse all` reset
 * every node at once.
 *
 * For the flat, copy-friendly string form, use `JsonBlock` instead.
 */
export function JsonTree({
  value,
  copy = false,
  maxHeight = '32rem',
}: {
  value: unknown
  copy?: boolean
  /** CSS max-height for the scroll region. */
  maxHeight?: string
}) {
  // Per-node open state is local, seeded from `mode`; `expand all`/`collapse all`
  // change the mode and bump `seq`, remounting the tree so every node re-seeds.
  const [mode, setMode] = useState<OpenMode>('depth')
  const [seq, setSeq] = useState(0)
  const apply = (m: OpenMode) => {
    setMode(m)
    setSeq((s) => s + 1)
  }

  return (
    <div>
      <div className="text-muted mb-2 flex items-center gap-3 font-mono text-[0.6875rem]">
        <button
          type="button"
          onClick={() => apply('all')}
          className="hover:text-primary transition-colors"
        >
          expand all
        </button>
        <button
          type="button"
          onClick={() => apply('none')}
          className="hover:text-primary transition-colors"
        >
          collapse all
        </button>
        {copy && (
          <CopyButton
            value={JSON.stringify(value, null, 2)}
            label="Copy fields"
            className="ml-auto"
          />
        )}
      </div>
      <div
        key={seq}
        className="bg-bg/60 border-line overflow-auto border py-2 font-mono text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        <Node k={null} value={value} depth={0} mode={mode} />
      </div>
    </div>
  )
}

/** How a freshly-mounted node decides whether it's open. */
type OpenMode = 'depth' | 'all' | 'none'

/** Auto-open the root + first level; deeper nesting starts folded. */
const OPEN_DEPTH = 2

function initialOpen(depth: number, mode: OpenMode): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return depth === 0 // keep the root open so something shows
  return depth < OPEN_DEPTH
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** One key/value (or array element) in the tree. */
function Node({
  k,
  value,
  depth,
  mode,
}: {
  /** Object key, or `null` for an array element / the root. */
  k: string | null
  value: unknown
  depth: number
  mode: OpenMode
}) {
  const obj = isPlainObject(value)
  const arr = Array.isArray(value)
  const entries: [string | null, unknown][] = obj
    ? Object.entries(value)
    : arr
      ? (value as unknown[]).map((v) => [null, v])
      : []
  const expandable = (obj || arr) && entries.length > 0
  const [open, setOpen] = useState(() => initialOpen(depth, mode))

  if (!expandable) {
    return (
      <Row depth={depth}>
        <span className="w-4 shrink-0" />
        <KeyLabel k={k} />
        {obj ? (
          <Punct>{'{}'}</Punct>
        ) : arr ? (
          <Punct>{'[]'}</Punct>
        ) : (
          <Value k={k} value={value} />
        )}
      </Row>
    )
  }

  const openB = arr ? '[' : '{'
  const closeB = arr ? ']' : '}'
  return (
    <div>
      <Row depth={depth} onClick={() => setOpen((o) => !o)}>
        <span className="text-muted w-4 shrink-0 select-none">{open ? '▾' : '▸'}</span>
        <KeyLabel k={k} />
        <Punct>{openB}</Punct>
        {!open && (
          <span className="text-muted/50">
            {' … '}
            <Punct>{closeB}</Punct>
            <span className="text-muted/40 ml-1.5">
              {entries.length} {arr ? 'items' : 'keys'}
            </span>
          </span>
        )}
      </Row>
      {open && (
        <>
          {entries.map(([ck, cv], i) => (
            <Node key={ck ?? i} k={ck} value={cv} depth={depth + 1} mode={mode} />
          ))}
          <Row depth={depth}>
            <span className="w-4 shrink-0" />
            <Punct>{closeB}</Punct>
          </Row>
        </>
      )}
    </div>
  )
}

/** A tree line, indented by depth; clickable when it toggles a node. */
function Row({
  depth,
  onClick,
  children,
}: {
  depth: number
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-start gap-1 pr-3',
        onClick && 'hover:bg-surface-2/40 cursor-pointer',
      )}
      style={{ paddingLeft: `${0.75 + depth * 1.05}rem` }}
    >
      {children}
    </div>
  )
}

function KeyLabel({ k }: { k: string | null }) {
  if (k === null) return null
  return (
    <span className="shrink-0">
      <span className="text-primary/90">{k}</span>
      <span className="text-muted/60">: </span>
    </span>
  )
}

/** Structural punctuation (brackets), de-emphasised. */
function Punct({ children }: { children: ReactNode }) {
  return <span className="text-muted/60">{children}</span>
}

/** Does a field name follow the Move `…timestamp_ms` convention for an epoch-ms
 *  instant? (`timestamp_ms`, `start_timestamp_ms`, `expiration_timestamp_ms`, …) */
function isTimestampMsKey(k: string | null): boolean {
  return k != null && /timestamp_ms/i.test(k)
}

// Only decorate values that read as a real instant: between 2000 and 2200. A
// `0`, a `null`-ish sentinel, or a u64 max would otherwise get a nonsense date.
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1)
const MAX_PLAUSIBLE_MS = Date.UTC(2200, 0, 1)

/** The epoch-ms a `timestamp_ms` leaf holds (u64s arrive as strings, smaller
 *  ints as numbers), or null when it isn't a plausible instant. */
function timestampMs(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN
  return Number.isFinite(n) && n >= MIN_PLAUSIBLE_MS && n < MAX_PLAUSIBLE_MS ? n : null
}

/** A primitive value: strings quoted with ids linkified, the rest plain. A
 *  `timestamp_ms` field's value is green with the decoded UTC time on hover. */
function Value({ k, value }: { k: string | null; value: unknown }) {
  if (value === null) return <span className="text-muted/60">null</span>
  const ms = isTimestampMsKey(k) ? timestampMs(value) : null
  if (ms != null) {
    const quoted = typeof value === 'string'
    return (
      <span
        className="text-primary cursor-help underline decoration-dotted underline-offset-2"
        title={describeInstant(ms)}
      >
        {quoted ? `"${value}"` : String(value)}
      </span>
    )
  }
  if (typeof value === 'string') {
    return (
      <span className="text-text break-all whitespace-pre-wrap">
        "{linkifyAddresses(value)}"
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return <span className="text-secondary">{String(value)}</span>
  }
  return <span className="text-text break-all">{String(value)}</span>
}
