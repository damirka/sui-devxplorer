import { type ReactNode } from 'react'
import { Muted } from '@/components/ui/Field'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { ErrorText } from '@/components/ui/ErrorText'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchObjectChangeInTx } from '@/lib/object'
import { unifiedJsonDiff, type UnifiedDiff } from '@/lib/jsonUnifiedDiff'
import { formatType } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * How one transaction changed one object's contents — its before → after as a
 * GitHub-style unified diff (`asTransactionObject`, lazily fetched). Shared by the
 * object view's Fields panel (via `FieldsDiff`) and the transaction view's
 * object-change list.
 */
export function ObjectChangeDiff({
  id,
  txDigest,
  type,
  note,
}: {
  id: string
  txDigest: string
  /** The object's Move type repr, shown as the diff's root label. */
  type: string | null
  /** Optional header note (e.g. a link to the producing transaction). */
  note?: ReactNode
}) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => fetchObjectChangeInTx(network, id, txDigest, signal),
    [network, id, txDigest],
  )

  if (loading) return <SkeletonLines count={4} />
  if (error) return <ErrorText error={error} />
  if (!data || data.kind === 'read') {
    return <Muted>this transaction didn’t change this object’s fields.</Muted>
  }

  const diff = unifiedJsonDiff(data.before, data.after, {
    label: type ? formatType(type) : undefined,
  })
  if (!diff) return <Muted>object is too large to diff inline.</Muted>
  if (diff.adds === 0 && diff.removes === 0) {
    return <Muted>no field changes (metadata-only update).</Muted>
  }
  return (
    <UnifiedDiffView
      diff={diff}
      note={note}
      created={data.before == null}
      deleted={data.after == null}
    />
  )
}

function UnifiedDiffView({
  diff,
  note,
  created,
  deleted,
}: {
  diff: UnifiedDiff
  note?: ReactNode
  created: boolean
  deleted: boolean
}) {
  return (
    <div>
      <div className="text-muted mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem]">
        {note}
        {created && <span className="text-secondary">created here</span>}
        {deleted && <span className="text-danger">deleted here</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-secondary tabular-nums">+{diff.adds}</span>
          <span className="text-danger tabular-nums">−{diff.removes}</span>
        </span>
      </div>
      <div className="border-line bg-bg/60 max-h-[32rem] overflow-auto border font-mono text-xs leading-relaxed">
        {diff.rows.map((r, i) =>
          r.kind === 'gap' ? (
            <div
              key={i}
              className="text-muted/60 bg-surface-2/40 border-line/60 border-y px-3 py-0.5 text-[0.6875rem] select-none"
            >
              ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                'flex px-3',
                r.kind === 'add' && 'bg-secondary/10 text-secondary',
                r.kind === 'remove' && 'bg-danger/10 text-danger',
                r.kind === 'context' && 'text-muted',
              )}
            >
              <span className="w-3 shrink-0 opacity-60 select-none">
                {r.kind === 'add' ? '+' : r.kind === 'remove' ? '-' : ' '}
              </span>
              <span className="whitespace-pre-wrap break-all">{r.text}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
