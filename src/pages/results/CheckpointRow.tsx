import { ChevronRight, Fuel, Users } from 'lucide-react'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { Hash } from '@/components/ui/Hash'
import { RowIndex } from '@/components/ui/RowIndex'
import { netGasUsed } from '@/lib/gas'
import { tipLagMs, type CheckpointSummary } from '@/lib/checkpoint'
import { formatAge, formatCount, formatSui, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/cn'
import { CheckpointTxs } from './CheckpointTxs'

/**
 * One checkpoint in the feed — a summary line that expands to its on-chain detail
 * and the transactions it sealed. Controlled by the parent (open + onToggle) so it
 * can enforce one-open-at-a-time and freeze the feed while a row is open. `now` is
 * the shared wall-clock tick, so every row's "age" advances together without each
 * holding its own timer.
 */
export function CheckpointRow({
  index,
  cp,
  now,
  open,
  onToggle,
}: {
  index: number
  cp: CheckpointSummary
  now: number
  open: boolean
  onToggle: () => void
}) {
  const lag = tipLagMs(cp.timestamp, now)
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-surface-2 flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition-colors"
      >
        <RowIndex n={index} />
        <ChevronRight
          size={13}
          className={cn('text-muted shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="text-primary hash shrink-0 tabular-nums">
          #{cp.sequenceNumber.toLocaleString()}
        </span>
        <span className="text-muted shrink-0 tabular-nums">
          {lag == null ? '—' : `${formatAge(lag)} ago`}
        </span>
        <span className="text-muted ml-auto inline-flex shrink-0 items-center gap-x-4 tabular-nums">
          <span className="inline-flex items-center gap-1" title="validators that signed">
            <Users size={12} />
            {cp.signers ?? '—'}
          </span>
          <span
            className="inline-flex w-[8rem] items-center justify-end gap-1"
            title="net gas used in this checkpoint"
          >
            <Fuel size={12} />
            {cp.gasUsed == null ? '—' : formatSui(cp.gasUsed)}
          </span>
          <span className="text-text w-[4.5rem] text-right" title="transactions in this checkpoint">
            {cp.txCount == null ? '—' : `${cp.txCount} tx`}
          </span>
        </span>
      </button>
      {open && <CheckpointDetail cp={cp} />}
    </li>
  )
}

/** The expanded panel under a checkpoint row: its digests and chain metadata, then
 *  the transactions it sealed. */
function CheckpointDetail({ cp }: { cp: CheckpointSummary }) {
  const rollingNet = netGasUsed(cp.rollingGas)
  return (
    <div className="border-line bg-bg space-y-5 border-t px-3 py-4">
      <FieldGrid cols={3}>
        <Field label="digest">
          <Hash value={cp.digest} />
        </Field>
        <Field label="previous">
          {cp.previousCheckpointDigest ? (
            <Hash value={cp.previousCheckpointDigest} />
          ) : (
            <Muted>—</Muted>
          )}
        </Field>
        <Field label="content digest">
          {cp.contentDigest ? <Hash value={cp.contentDigest} /> : <Muted>—</Muted>}
        </Field>
        <Field label="sealed">
          <span className="text-text">{formatTimestamp(cp.timestamp)}</span>
        </Field>
        <Field label="epoch">
          <span className="text-text tabular-nums">{cp.epochId ?? '—'}</span>
        </Field>
        <Field label="signers">
          <span className="text-text tabular-nums">{cp.signers ?? '—'}</span>
        </Field>
        <Field label="network txns">
          <span
            className="text-text tabular-nums"
            title={cp.networkTotalTransactions.toLocaleString()}
          >
            {formatCount(cp.networkTotalTransactions)}
          </span>
        </Field>
        <Field label="gas (checkpoint)">
          <span className="text-text tabular-nums">
            {cp.gasUsed == null ? '—' : formatSui(cp.gasUsed)}
          </span>
        </Field>
        <Field label="gas (epoch rolling)">
          <span className="text-text tabular-nums">
            {rollingNet == null ? '—' : formatSui(rollingNet)}
          </span>
        </Field>
      </FieldGrid>
      <CheckpointTxs sequenceNumber={cp.sequenceNumber} txCount={cp.txCount} />
    </div>
  )
}
