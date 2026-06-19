import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { JsonBlock } from '@/components/ui/JsonBlock'
import { LinkedHash, useVersionHref, useSearchHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  describeOwner,
  fetchObjectVersions,
  fetchObjectChangeInTx,
  type ObjectVersionNode,
} from '@/lib/object'
import { diffJson, type JsonChange } from '@/lib/jsonDiff'
import { formatTimestamp } from '@/lib/format'
import { truncateMiddle } from '@/lib/search'
import { cn } from '@/lib/cn'

/**
 * An object's version history, newest-first. Each row pins the object to that
 * version (`?version=`), links the transaction that produced it, and expands to
 * show exactly what that transaction changed in the object (a field-level diff of
 * its contents, via `asTransactionObject`). The row for the version currently
 * being viewed is highlighted. Pairs with the left/right arrow-key stepper wired
 * up in `ObjectView`.
 *
 * Collapsed by default — a power feature kept out of the way — and the history
 * isn't fetched until it's opened (`enabled: open`); each row's diff isn't
 * fetched until that row is expanded.
 */
export function ObjectHistory({
  id,
  currentVersion,
  showOwners = false,
}: {
  id: string
  /** The version currently shown — its row is highlighted. */
  currentVersion: number | null
  /** Show who owned the object at each version. Only meaningful for
   *  address/object-owned objects — off for shared/immutable. */
  showOwners?: boolean
}) {
  const { network } = useNetwork()
  const [open, setOpen] = useState(false)
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}`,
    (args, signal) => fetchObjectVersions(network, id, args, signal),
    { enabled: open },
  )

  return (
    <Panel>
      <PanelSection
        label={
          <CollapseToggle
            open={open}
            onToggle={() => setOpen((o) => !o)}
            label="Version history"
          />
        }
        action={
          open ? (
            <span className="flex items-center gap-3">
              <span className="text-muted/60 hidden font-mono text-[0.625rem] tracking-wide sm:inline">
                ←/→ to step
              </span>
              {paged && <Pager {...pagerProps} label="versions" />}
            </span>
          ) : (
            <span className="text-muted/60 font-mono text-[0.625rem] tracking-wide">
              show
            </span>
          )
        }
      >
        {open && (
          <DataList
            loading={loading}
            error={error}
            items={items}
            empty="no version history."
          >
            {(v) => (
              <HistoryRow
                key={v.version}
                id={id}
                v={v}
                currentVersion={currentVersion}
                showOwners={showOwners}
              />
            )}
          </DataList>
        )}
      </PanelSection>
    </Panel>
  )
}

/** One version row: the snapshot link, timestamp, optional owner, a clickable
 *  transaction digest, and an expander for that tx's object diff. */
function HistoryRow({
  id,
  v,
  currentVersion,
  showOwners,
}: {
  id: string
  v: ObjectVersionNode
  currentVersion: number | null
  showOwners: boolean
}) {
  const versionHref = useVersionHref()
  const searchHref = useSearchHref()
  const [open, setOpen] = useState(false)
  const active = v.version === currentVersion
  const ownerAddr = describeOwner(v.owner).address

  return (
    <li
      className={cn(
        '-mx-2 px-2 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-surface-2',
      )}
    >
      {/* Fixed-width version + timestamp columns so the owner / digest line up
          across rows (a 1- vs 2-digit day no longer shifts everything). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
        {/* Expand the per-transaction object diff (only when a producing tx is
            known). An explicit label, not a bare chevron, so it's discoverable;
            both labels are the same length, so the columns stay aligned. */}
        {v.txDigest ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title="what this transaction changed in this object"
            className={cn(
              'inline-flex w-28 shrink-0 items-center gap-1 font-mono text-[0.6875rem] transition-colors',
              open ? 'text-primary' : 'text-muted hover:text-primary',
            )}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {open ? 'hide changes' : 'show changes'}
          </button>
        ) : (
          <span className="w-28 shrink-0" />
        )}
        <Link
          to={versionHref(v.version)}
          title={`view this object at v${v.version}`}
          className={cn(
            'w-28 shrink-0 tabular-nums hover:underline',
            active ? 'text-primary' : 'text-text',
          )}
        >
          v{v.version}
        </Link>
        <span className="text-muted shrink-0 tabular-nums sm:w-64">
          {formatTimestamp(v.timestamp)}
        </span>
        {showOwners && ownerAddr && (
          <span
            className="text-muted inline-flex shrink-0 items-center gap-1.5"
            title="owner at this version"
          >
            owner <LinkedHash value={ownerAddr} />
          </span>
        )}
        {v.txDigest && (
          <Link
            to={searchHref(v.txDigest)}
            title={`view transaction ${v.txDigest}`}
            className="hash text-muted hover:text-primary ml-auto shrink-0 hover:underline"
          >
            {truncateMiddle(v.txDigest)}
          </Link>
        )}
        {active && (
          <span className="border-primary/40 text-primary shrink-0 border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase">
            viewing
          </span>
        )}
      </div>
      {open && v.txDigest && <ObjectChangeDiff id={id} txDigest={v.txDigest} />}
    </li>
  )
}

/** Lazily fetches how the object changed in one transaction and renders the
 *  field-level diff (or a created/deleted/read note). */
function ObjectChangeDiff({ id, txDigest }: { id: string; txDigest: string }) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => fetchObjectChangeInTx(network, id, txDigest, signal),
    [network, id, txDigest],
  )

  if (loading) {
    return (
      <Indent>
        <SkeletonLines count={2} />
      </Indent>
    )
  }
  if (error) {
    return <Note className="text-danger">failed to load changes: {error.message}</Note>
  }
  if (!data) {
    return <Note>this transaction didn’t reference this object.</Note>
  }
  if (data.kind === 'read') {
    return <Note>read as an unchanged shared input — no change.</Note>
  }
  if (data.idCreated && data.before == null) {
    return (
      <Indent>
        <div className="text-secondary mb-1.5 font-mono text-xs">
          created in this transaction
        </div>
        {data.after != null && <JsonBlock value={data.after} />}
      </Indent>
    )
  }
  if (data.idDeleted && data.after == null) {
    return (
      <Indent>
        <div className="text-danger mb-1.5 font-mono text-xs">
          deleted in this transaction
        </div>
        {data.before != null && <JsonBlock value={data.before} />}
      </Indent>
    )
  }
  return <DiffList changes={diffJson(data.before, data.after)} />
}

/** Cap on rendered changes — a few mass-mutating txs (e.g. a big table) could
 *  otherwise produce hundreds of diff lines. */
const MAX_CHANGES = 80

function DiffList({ changes }: { changes: JsonChange[] }) {
  if (changes.length === 0) {
    return <Note>no field changes (metadata-only update).</Note>
  }
  const shown = changes.slice(0, MAX_CHANGES)
  return (
    <Indent>
      <ul className="border-line space-y-1 border-l pl-3 font-mono text-xs">
        {shown.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-primary shrink-0">{c.path || '(root)'}</span>
            {c.kind === 'added' ? (
              <span className="text-secondary inline-flex items-baseline gap-1">
                <span className="shrink-0">+</span>
                <Val v={c.after} />
              </span>
            ) : c.kind === 'removed' ? (
              <Val v={c.before} className="text-danger line-through" />
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <Val v={c.before} className="text-danger" />
                <span className="text-muted shrink-0">→</span>
                <Val v={c.after} className="text-secondary" />
              </span>
            )}
          </li>
        ))}
      </ul>
      {changes.length > shown.length && (
        <div className="text-muted mt-1.5 font-mono text-xs">
          +{changes.length - shown.length} more changed fields
        </div>
      )}
    </Indent>
  )
}

/** Render one diff value compactly — strings as-is, everything else as JSON,
 *  clamped with the full value in the tooltip. */
function Val({ v, className }: { v: unknown; className?: string }) {
  const full = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v))
  const clamped = full.length > 160 ? full.slice(0, 159) + '…' : full
  return (
    <span
      className={cn('break-all', className)}
      title={full.length > 160 ? full : undefined}
    >
      {clamped}
    </span>
  )
}

/** Indent a row's expanded body to line up under the version column. */
function Indent({ children }: { children: ReactNode }) {
  return <div className="mb-3 pl-[25px]">{children}</div>
}

function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Indent>
      <span className={cn('text-muted font-mono text-xs', className)}>{children}</span>
    </Indent>
  )
}
