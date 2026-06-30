import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/EmptyState'
import { DataList } from '@/components/ui/DataList'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { HoverCard } from '@/components/ui/HoverCard'
import { CopyJsonButton } from '@/components/ui/CopyJsonButton'
import { useNetwork } from '@/context/useNetwork'
import type { Network } from '@/context/network-context'
import { usePolledAsync, useAsync } from '@/lib/useAsync'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/cn'
import { formatNextEpoch, formatSuiCompact } from '@/lib/format'
import {
  fetchValidatorSet,
  fetchValidatorGroup,
  stakePerVotingPower,
  cmpBig,
  ADMISSION,
  type ValidatorGroup,
  type ValidatorSet,
  type ValidatorSummary,
  type ValidatorView,
} from '@/lib/validators'
import { ValidatorRow } from './ValidatorRow'
import { StakeBreakdown } from './StakeBreakdown'

// The active set turns over only at an epoch boundary (~daily), so a slow poll is
// plenty — it just re-anchors the figures after a rollover. The 1s wall-clock
// tick (below) is what keeps the next-epoch countdown live between polls.
const POLL_MS = 60_000

type SortKey = 'stake' | 'power' | 'commission' | 'gas' | 'name'

// Ordered to mirror the row columns left→right (name · power · stake ·
// commission · gas) so a sort button sits under the column it sorts.
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'name' },
  { key: 'power', label: 'power' },
  { key: 'stake', label: 'stake' },
  { key: 'commission', label: 'commission' },
  { key: 'gas', label: 'gas' },
]

const TABS: { key: ValidatorGroup; label: string }[] = [
  { key: 'active', label: 'active' },
  { key: 'pending', label: 'pending' },
  { key: 'candidate', label: 'candidates' },
  { key: 'inactive', label: 'inactive' },
]

/** Order the validators by the chosen key: stake/power/gas descending (biggest
 *  first), commission ascending (cheapest first), name A→Z. */
function sortValidators(vs: ValidatorSummary[], key: SortKey): ValidatorSummary[] {
  const out = [...vs]
  switch (key) {
    case 'stake':
      return out.sort((a, b) => cmpBig(b.stake, a.stake))
    case 'power':
      return out.sort((a, b) => b.votingPower - a.votingPower)
    case 'commission':
      // Ascending — lowest commission first (the figure stakers care about).
      return out.sort((a, b) => a.commissionRate - b.commissionRate)
    case 'gas':
      return out.sort((a, b) => cmpBig(b.gasPrice, a.gasPrice))
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** Coerce a `vtab` query value to a known group (default `active`). */
function parseGroup(v: string | null): ValidatorGroup {
  return v === 'pending' || v === 'candidate' || v === 'inactive' ? v : 'active'
}

/**
 * The validator-set dashboard. Reads the system state (0x5's inner value) for the
 * active set + epoch-level figures in one query, summarises them up top (with the
 * voting-power admission economics), then lists validators under active / pending
 * / candidate tabs — the pending and candidate tables loaded lazily per tab. Each
 * row is sortable and expands to its full on-chain detail.
 */
export function ValidatorsView() {
  const { network } = useNetwork()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sort, setSort] = useState<SortKey>('stake')

  // Tab + the opened validator live in the URL, so any state is shareable: the
  // `?vtab=…&validator=0x…` link reopens the same view. One validator is open at
  // a time (same affordance as the checkpoints feed).
  const tab = parseGroup(searchParams.get('vtab'))
  const openAddr = searchParams.get('validator')
  // Current vs. next-epoch projection — shareable via `?view=next`.
  const view: ValidatorView = searchParams.get('view') === 'next' ? 'next' : 'current'
  // The validator the URL deep-linked to *at load* — its row auto-scrolls into
  // view once rendered. Captured once so later manual opens don't yank the page.
  const initialTarget = useRef(searchParams.get('validator')).current

  const set = usePolledAsync(
    (signal) => fetchValidatorSet(network, signal),
    [network],
    POLL_MS,
  )
  // 1s clock so the next-epoch countdown keeps advancing between the slow polls.
  const now = useNow(1000)

  // Build the URL search params for a given (tab, opened validator) — the single
  // place the deep-link shape is defined (used for both row hrefs and tab switches).
  const paramsFor = (group: ValidatorGroup, validator: string | null) => {
    const p = new URLSearchParams(searchParams)
    p.set('search', 'validators')
    if (group === 'active') p.delete('vtab')
    else p.set('vtab', group)
    if (validator) p.set('validator', validator)
    else p.delete('validator')
    return p
  }
  const hrefFor = (validator: string | null) => `?${paramsFor(tab, validator).toString()}`

  if (set.loading && !set.data) {
    return (
      <div className="space-y-6">
        <div className="border-line bg-surface h-[12rem] border" />
        <Panel>
          <PanelSection label="Validators" index={1}>
            <SkeletonLines count={10} />
          </PanelSection>
        </Panel>
      </div>
    )
  }

  if (set.error || !set.data || set.data.validators.length === 0) {
    return (
      <EmptyState title="validators unavailable">
        {set.error ? set.error.message : 'no validator set returned for this network.'}
      </EmptyState>
    )
  }

  const data = set.data
  const nextEpochInMs = data.nextEpochMs != null ? data.nextEpochMs - now : null

  return (
    <div className="space-y-6">
      <ValidatorSummary set={data} nextEpochInMs={nextEpochInMs} />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabBar
            value={tab}
            counts={{
              active: data.validators.length,
              pending: data.pendingCount,
              candidate: data.candidateCount,
              inactive: data.inactiveCount,
            }}
            onChange={(t) => setSearchParams(paramsFor(t, null))}
          />
          <ViewToggle
            value={view}
            onChange={(next) => {
              const p = new URLSearchParams(searchParams)
              if (next === 'next') p.set('view', 'next')
              else p.delete('view')
              setSearchParams(p)
            }}
          />
        </div>
        <GroupPanel
          network={network}
          set={data}
          group={tab}
          view={view}
          sort={sort}
          onSort={setSort}
          openAddr={openAddr}
          hrefFor={hrefFor}
          initialTarget={initialTarget}
        />
      </div>
    </div>
  )
}

/** The list for the selected tab. The active set comes from props; pending and
 *  candidate tables are fetched lazily here (keyed on the tab) — switching to a
 *  tab is what triggers its load. */
function GroupPanel({
  network,
  set,
  group,
  view,
  sort,
  onSort,
  openAddr,
  hrefFor,
  initialTarget,
}: {
  network: Network
  set: ValidatorSet
  group: ValidatorGroup
  view: ValidatorView
  sort: SortKey
  onSort: (k: SortKey) => void
  openAddr: string | null
  /** Shareable href that opens (or, when already open, closes) a validator. */
  hrefFor: (validator: string | null) => string
  /** The deep-linked validator to auto-scroll to on load, or `null`. */
  initialTarget: string | null
}) {
  const tableId =
    group === 'pending'
      ? set.pendingTableId
      : group === 'candidate'
        ? set.candidateTableId
        : group === 'inactive'
          ? set.inactiveTableId
          : null

  // Fetch the table for non-active tabs. For the active tab (or an empty table)
  // the fetcher short-circuits to `[]` and we use the already-loaded set instead.
  const lazy = useAsync(
    (signal) =>
      group !== 'active' && tableId
        ? fetchValidatorGroup(network, tableId, signal)
        : Promise.resolve<ValidatorSummary[]>([]),
    [network, group, tableId],
  )

  const items = group === 'active' ? set.validators : tableId ? (lazy.data ?? []) : []
  const loading = group !== 'active' && tableId != null && lazy.loading && lazy.data == null
  const error = group === 'active' ? null : lazy.error

  // Sort for display, the max voting power (scales each row's power bar), and the
  // active set's projected next-epoch total stake — from which each validator's
  // estimated next-epoch voting power (its share, in basis points) is derived to
  // drive the at-risk / removal highlight. Only meaningful for the active set.
  const { rows, maxPower, nextTotal } = useMemo(() => {
    return {
      rows: sortValidators(items, sort),
      maxPower: items.reduce((m, v) => Math.max(m, v.votingPower), 0),
      nextTotal: group === 'active' ? items.reduce((s, v) => s + v.nextEpochStake, 0n) : 0n,
    }
  }, [items, sort, group])

  const label = group === 'candidate' ? 'candidates' : group
  return (
    <Panel>
      <PanelSection
        label={`${label} · ${items.length}`}
        index={1}
        action={<SortSwitch value={sort} onChange={onSort} />}
      >
        <DataList
          loading={loading}
          error={error}
          items={rows}
          empty={`no ${label} validators.`}
          skeleton={8}
        >
          {(v, i) => {
            const open = openAddr === v.address
            return (
              <ValidatorRow
                key={v.address}
                index={i + 1}
                v={v}
                view={view}
                active={group === 'active'}
                powerShare={maxPower > 0 ? v.votingPower / maxPower : 0}
                projectedVotingPower={
                  nextTotal > 0n ? Number((v.nextEpochStake * 10000n) / nextTotal) : null
                }
                referenceGasPrice={set.referenceGasPrice}
                open={open}
                to={hrefFor(open ? null : v.address)}
                autoScroll={v.address === initialTarget}
              />
            )
          }}
        </DataList>
      </PanelSection>
    </Panel>
  )
}

/** The epoch-level figures above the list — the set in aggregate, plus the
 *  voting-power admission economics. */
function ValidatorSummary({
  set,
  nextEpochInMs,
}: {
  set: ValidatorSet
  nextEpochInMs: number | null
}) {
  // 1 voting power "costs" total_stake / 10_000; joining needs `joinVotingPower`
  // of them. These derive the live SUI figures behind the admission thresholds.
  const vpCost = stakePerVotingPower(set.totalStake)
  const joinReq = vpCost * BigInt(ADMISSION.joinVotingPower)

  // Next-epoch projection of the active set: each validator's projected stake,
  // plus the deposits / withdrawals queued to land at the rollover. Surfaced on
  // hover over the total — the absolute next-epoch figure shows the net change
  // (rewards + flows) that a compact headline can't.
  const nextTotalStake = set.validators.reduce((s, v) => s + v.nextEpochStake, 0n)
  const pendingDeposits = set.validators.reduce((s, v) => s + v.pendingStake, 0n)
  const pendingWithdrawals = set.validators.reduce((s, v) => s + v.pendingSuiWithdraw, 0n)
  const admissionHelp =
    'Validator admission is voting-power based, phased in over hardcoded protocol ' +
    'steps (12,8,4) → (6,4,2) → (3,2,1); mainnet is in the final phase. ' +
    '1 voting power = total stake ÷ 10,000.'

  return (
    <div className="border-line bg-surface border">
      <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b p-4">
        <Badge>validator set</Badge>
        <span className="text-primary font-mono text-sm font-bold tracking-[0.18em]">
          EPOCH {set.epoch.toLocaleString()}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-muted inline-flex items-center gap-1.5 font-mono text-xs">
            <span className="tracking-wider uppercase">next epoch</span>
            <span
              className="text-text tabular-nums"
              title="scheduled boundary (epoch start + protocol epoch duration); the actual transition can vary by a second or two"
            >
              {formatNextEpoch(nextEpochInMs)}
            </span>
          </span>
          <CopyJsonButton
            value={set.raw}
            title="copy the full SuiSystemStateInner json (the whole system state)"
          />
        </div>
      </div>

      <dl className="bg-line grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
        <StatCell
          label="total stake"
          value={formatSuiCompact(set.totalStake)}
          card={
            <StakeBreakdown
              title="total stake → next epoch"
              current={set.totalStake}
              next={nextTotalStake}
              deposits={pendingDeposits}
              withdrawals={pendingWithdrawals}
            />
          }
        />
        <StatCell
          label="validators"
          value={
            set.maxValidatorCount != null
              ? `${set.validators.length} / ${set.maxValidatorCount}`
              : String(set.validators.length)
          }
          title="active validators / max allowed"
        />
        <StatCell
          label="ref gas"
          value={set.referenceGasPrice.toLocaleString()}
          title="network reference gas price (MIST per gas unit)"
        />
        <StatCell label="protocol" value={set.protocolVersion} title="current protocol version" />
        <StatCell
          label="storage fund"
          value={formatSuiCompact(set.storageFund)}
          title={`${set.storageFund.toLocaleString()} MIST`}
        />
        <StatCell
          label="subsidy"
          value={formatSuiCompact(set.stakeSubsidy)}
          title="stake distributed as subsidy each epoch"
        />
      </dl>

      <div className="border-line flex flex-wrap items-center gap-x-5 gap-y-2 border-t p-4 font-mono text-xs">
        <Badge tone="muted" className="cursor-help" title={admissionHelp}>
          admission
        </Badge>
        <Pair label="1 voting power" value={`≈ ${formatSuiCompact(vpCost)}`} title={admissionHelp} />
        <Pair
          label={`join ≥ ${ADMISSION.joinVotingPower} vp`}
          value={`≈ ${formatSuiCompact(joinReq)}`}
          tone="text-primary"
          title={`A candidate must reach ${ADMISSION.joinVotingPower} voting power (≈ ${formatSuiCompact(joinReq)}) to join the active set at an epoch change.`}
        />
        <span className="text-muted">
          at-risk &lt; {ADMISSION.lowStakeVotingPower} vp · removed &lt;{' '}
          {ADMISSION.veryLowStakeVotingPower} vp
        </span>
      </div>
    </div>
  )
}

/** A label-over-value cell in the summary's stat grid. Pass `card` to reveal a
 *  hover card on the value (instant, themed — vs. a slow native `title`). */
function StatCell({
  label,
  value,
  title,
  card,
}: {
  label: string
  value: ReactNode
  title?: string
  card?: ReactNode
}) {
  const valueEl = (
    <span className="text-text font-mono text-sm tabular-nums" title={card ? undefined : title}>
      {value}
    </span>
  )
  return (
    <div className="bg-surface px-4 py-3">
      <div className="panel-label">{label}</div>
      <div className="mt-1">{card ? <HoverCard card={card}>{valueEl}</HoverCard> : valueEl}</div>
    </div>
  )
}

/** An inline `LABEL value` pair in the admission strip. */
function Pair({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: ReactNode
  tone?: string
  title?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="text-muted tracking-wider uppercase">{label}</span>
      <span className={cn('tabular-nums', tone ?? 'text-text')}>{value}</span>
    </span>
  )
}

/** The active / pending / candidate tab bar, each with its live count. */
function TabBar({
  value,
  counts,
  onChange,
}: {
  value: ValidatorGroup
  counts: Record<ValidatorGroup, number>
  onChange: (g: ValidatorGroup) => void
}) {
  return (
    <div role="tablist" aria-label="validator groups" className="flex flex-wrap items-center gap-1 font-mono text-xs">
      {TABS.map((t) => {
        const selected = value === t.key
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-2 border px-3 py-1.5 transition-colors',
              selected
                ? 'border-primary text-primary bg-surface-2'
                : 'border-line text-muted hover:border-primary hover:text-primary',
            )}
          >
            <span className="tracking-wider uppercase">{t.label}</span>
            <span className={cn('tabular-nums', selected ? 'text-primary' : 'text-muted')}>
              {counts[t.key]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Top-level perspective switch: the set now, or its next-epoch projection
 *  (which swaps in each validator's next-epoch stake / commission / gas and
 *  shows the per-column delta). */
function ViewToggle({
  value,
  onChange,
}: {
  value: ValidatorView
  onChange: (v: ValidatorView) => void
}) {
  const opts: { key: ValidatorView; label: string }[] = [
    { key: 'current', label: 'current' },
    { key: 'next', label: 'next epoch' },
  ]
  return (
    <div
      role="group"
      aria-label="epoch view"
      className="inline-flex items-center gap-1 font-mono text-xs"
    >
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={cn(
            'border px-2.5 py-1.5 tracking-wider uppercase transition-colors',
            value === o.key
              ? 'border-primary text-primary bg-surface-2'
              : 'border-line text-muted hover:border-primary hover:text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A toggle for how the validator list is ordered. */
function SortSwitch({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (k: SortKey) => void
}) {
  return (
    <div
      role="group"
      aria-label="sort validators"
      className="inline-flex items-center gap-1 font-mono text-xs"
    >
      <span className="text-muted mr-1 hidden tracking-wider uppercase sm:inline">sort</span>
      {SORTS.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          aria-pressed={value === s.key}
          className={cn(
            'border px-2 py-1 transition-colors',
            value === s.key
              ? 'border-primary text-primary bg-surface-2'
              : 'border-line text-muted hover:border-primary hover:text-primary',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
