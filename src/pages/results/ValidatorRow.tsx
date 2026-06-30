import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { Hash } from '@/components/ui/Hash'
import { RowIndex } from '@/components/ui/RowIndex'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { CopyButton } from '@/components/ui/CopyButton'
import { CopyJsonButton } from '@/components/ui/CopyJsonButton'
import { HoverCard } from '@/components/ui/HoverCard'
import { LinkedHash } from '@/components/ui/links'
import { formatCount, formatSui, formatSuiCompact, formatTokenAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ADMISSION, isGasOutlier, type ValidatorSummary, type ValidatorView } from '@/lib/validators'
import { StakeBreakdown } from './StakeBreakdown'

/** Basis points → a trimmed percentage label: `800` → `8%`, `13` → `0.13%`. */
function pct(bps: number): string {
  const p = bps / 100
  return (Number.isInteger(p) ? String(p) : p.toFixed(2)) + '%'
}

/** A small coloured per-column delta chip (`+0.5%`, `−1.2M`, `+20`), shown to the
 *  left of a value in the next-epoch view. Green for an increase, red for a
 *  decrease; nothing when unchanged. */
function Delta({ text, up }: { text: string | null; up: boolean }) {
  if (!text) return null
  return (
    <span className={cn('mr-1.5 text-[0.65rem]', up ? 'text-secondary' : 'text-danger')}>
      {text}
    </span>
  )
}

/** Signed compact SUI delta without unit: `+220k` / `−1.2M`; `null` when zero. */
function suiDelta(d: bigint): string | null {
  if (d === 0n) return null
  const sui = Math.round(Number(d < 0n ? -d : d) / 1e9)
  return (d > 0n ? '+' : '−') + formatCount(sui)
}
/** Signed commission/percent delta from a basis-points difference. */
function pctDelta(bps: number): string | null {
  if (bps === 0) return null
  const p = Math.abs(bps) / 100
  return (bps > 0 ? '+' : '−') + (Number.isInteger(p) ? String(p) : p.toFixed(2)) + '%'
}
/** Signed integer delta (gas price). */
function gasDelta(d: bigint): string | null {
  if (d === 0n) return null
  return (d > 0n ? '+' : '−') + (d < 0n ? -d : d).toLocaleString()
}

/**
 * The validator's lifecycle-risk status, if any — drives the row's colour tint
 * and status chip. Most severe first: a scheduled deactivation or a projected
 * next-epoch voting power below the removal threshold is `danger` (red); a
 * projected (or currently on-chain) at-risk standing is `warning` (amber).
 * `projectedVp` is the estimated next-epoch voting power (active set only; `null`
 * elsewhere, where the at-risk mechanic doesn't apply).
 */
function rowStatus(
  v: ValidatorSummary,
  projectedVp: number | null,
): { tone: 'danger' | 'warning'; label: string; title: string } | null {
  if (v.deactivationEpoch != null)
    return {
      tone: 'danger',
      label: 'leaving',
      title: `scheduled to deactivate at epoch ${v.deactivationEpoch}`,
    }
  if (projectedVp != null && projectedVp < ADMISSION.veryLowStakeVotingPower)
    return {
      tone: 'danger',
      label: 'removing',
      title: `projected next-epoch voting power (${projectedVp}) is below the removal threshold (${ADMISSION.veryLowStakeVotingPower})`,
    }
  if (projectedVp != null && projectedVp < ADMISSION.lowStakeVotingPower)
    return {
      tone: 'warning',
      label: 'at risk',
      title: `projected next-epoch voting power (${projectedVp}) is below the at-risk threshold (${ADMISSION.lowStakeVotingPower})`,
    }
  if (v.atRisk != null)
    return {
      tone: 'warning',
      label: 'at risk',
      title: `below the low-stake threshold for ${v.atRisk} epoch(s) — eligible for removal`,
    }
  return null
}

/** The next-epoch stake hover card for one validator. */
function stakeCard(v: ValidatorSummary) {
  return (
    <StakeBreakdown
      title="stake → next epoch"
      current={v.stake}
      next={v.nextEpochStake}
      deposits={v.pendingStake}
      withdrawals={v.pendingSuiWithdraw}
    />
  )
}

/** Small square validator logo with a monospace-initial fallback (covers a
 *  missing, broken, or unset `image_url` — common on testnet). */
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <span className="border-line bg-surface-2 text-muted grid size-5 shrink-0 place-items-center text-[0.6rem] font-bold uppercase">
        {name.replace(/[^a-z0-9]/i, '').charAt(0) || '?'}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className="border-line size-5 shrink-0 border object-cover"
    />
  )
}

/**
 * One validator in the set — a summary line (rank, logo, name, voting-power bar,
 * stake, commission, gas price) that expands to its full on-chain detail. The
 * parent owns `open` (derived from the URL) so it can enforce one-open-at-a-time,
 * mirroring the checkpoints feed. `powerShare` (0–1, relative to the strongest
 * validator) sizes the voting-power bar so the distribution reads at a glance.
 *
 * The summary line is a `<Link>` to the row's shareable `to` href — clicking it
 * opens (or, when already open, closes) this validator by flipping the URL's
 * `?validator=` param, so the open state is deep-linkable. When `autoScroll` is
 * set (the deep-linked validator on load) the row scrolls itself into view.
 */
export function ValidatorRow({
  index,
  v,
  view,
  active = true,
  powerShare,
  projectedVotingPower = null,
  referenceGasPrice,
  open,
  to,
  autoScroll = false,
}: {
  index: number
  v: ValidatorSummary
  /** `next` swaps the stake / commission / gas columns to their next-epoch
   *  values and shows the per-column delta. */
  view: ValidatorView
  /** Whether this is the active set. The lifecycle-risk highlight (at-risk /
   *  leaving / removing) is an active-set mechanic, so it's suppressed on the
   *  pending / candidate / inactive tabs — where e.g. every validator already
   *  carries a deactivation epoch and would otherwise all read as "leaving". */
  active?: boolean
  powerShare: number
  /** Estimated next-epoch voting power (active set only) — drives the at-risk /
   *  removal row highlight; `null` where the mechanic doesn't apply. */
  projectedVotingPower?: number | null
  /** Network reference gas price — a validator quoting drastically off it is
   *  flagged red (see {@link isGasOutlier}). */
  referenceGasPrice: bigint
  open: boolean
  /** Shareable href that toggles this validator's open state via the URL. */
  to: string
  /** Scroll this row into view on mount (the deep-link target). */
  autoScroll?: boolean
}) {
  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!autoScroll) return
    // rAF so the expanded detail is laid out before we centre the row.
    const id = requestAnimationFrame(() =>
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
    return () => cancelAnimationFrame(id)
  }, [autoScroll])

  // In the next-epoch view the three columns that have a next value swap to it,
  // each prefixed with the delta from the current value. Voting power has no
  // next-epoch value on-chain (it's recomputed at the boundary), so it always
  // shows the current share.
  const isNext = view === 'next'
  const stakeVal = isNext ? v.nextEpochStake : v.stake
  const commVal = isNext ? v.nextEpochCommissionRate : v.commissionRate
  const gasVal = isNext ? v.nextEpochGasPrice : v.gasPrice

  const gasOutlier = isGasOutlier(gasVal, referenceGasPrice)
  const gasTitle =
    gasOutlier && referenceGasPrice > 0n
      ? `${(Number(gasVal) / Number(referenceGasPrice)).toFixed(1)}× the reference gas price (${referenceGasPrice.toLocaleString()} MIST) — drastically off the network rate`
      : 'gas price (MIST)'

  // Lifecycle-risk status → tints the whole summary line (red for leaving /
  // removal, amber for at-risk) and shows a matching chip. Active set only.
  const status = active ? rowStatus(v, projectedVotingPower) : null
  return (
    <li ref={rowRef}>
      <Link
        to={to}
        replace
        aria-expanded={open}
        className={cn(
          'group flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition-colors',
          status?.tone === 'danger'
            ? 'bg-danger/10 hover:bg-danger/20'
            : status?.tone === 'warning'
              ? 'bg-warning/10 hover:bg-warning/20'
              : 'hover:bg-surface-2',
        )}
      >
        <RowIndex n={index} />
        <ChevronRight
          size={13}
          className={cn('text-muted shrink-0 transition-transform', open && 'rotate-90')}
        />
        <Avatar src={v.imageUrl} name={v.name} />
        <span
          className="text-primary hash min-w-0 max-w-[10rem] shrink-0 truncate group-hover:underline"
          title={v.name}
        >
          {v.name}
        </span>
        {status && (
          <span
            className={cn(
              'shrink-0 text-[0.65rem] tracking-wider uppercase',
              status.tone === 'danger' ? 'text-danger' : 'text-warning',
            )}
            title={status.title}
          >
            {status.label}
          </span>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-x-4 tabular-nums">
          {/* Voting-power bar + value — the share of consensus weight (current;
              recomputed at the epoch boundary, so no next-epoch value). */}
          <span
            className="hidden items-center gap-1.5 sm:inline-flex"
            title={isNext ? 'voting power (current — recomputed next epoch)' : 'voting power'}
          >
            <span className="bg-surface-2 relative block h-1.5 w-16 overflow-hidden">
              <span
                className="bg-primary absolute inset-y-0 left-0"
                style={{ width: `${Math.max(2, powerShare * 100)}%` }}
              />
            </span>
            <span className="text-text w-12 text-right">{pct(v.votingPower)}</span>
          </span>
          <HoverCard align="right" card={stakeCard(v)} className="text-muted w-[8rem] text-right">
            {isNext && <Delta text={suiDelta(v.nextEpochStake - v.stake)} up={v.nextEpochStake > v.stake} />}
            {formatSuiCompact(stakeVal)}
          </HoverCard>
          <span className="text-muted w-[4.5rem] text-right" title="commission rate">
            {isNext && (
              <Delta
                text={pctDelta(v.nextEpochCommissionRate - v.commissionRate)}
                up={v.nextEpochCommissionRate > v.commissionRate}
              />
            )}
            {pct(commVal)}
          </span>
          <span
            className={cn(
              'hidden w-[6.5rem] text-right md:inline',
              gasOutlier ? 'text-danger' : 'text-muted',
            )}
            title={gasTitle}
          >
            {isNext && (
              <Delta text={gasDelta(v.nextEpochGasPrice - v.gasPrice)} up={v.nextEpochGasPrice > v.gasPrice} />
            )}
            {gasVal.toLocaleString()}
          </span>
        </span>
      </Link>
      {open && <ValidatorDetail v={v} referenceGasPrice={referenceGasPrice} />}
    </li>
  )
}

/** Per-field "now → next epoch" pair: shows the next-epoch value only when it
 *  actually differs, so a validator that isn't changing anything stays quiet. */
function NextEpoch({ children }: { children: React.ReactNode }) {
  return <span className="text-muted ml-2 text-[0.7rem]">→ {children}</span>
}

/** A long opaque value (a base64 pubkey or a network multiaddr) shown with a
 *  copy affordance — pubkeys truncate (they're unreadable blobs), addresses show
 *  in full (they carry meaning). `—` when the field is unset. A pending
 *  next-epoch rotation (`next`, when set and different) shows beneath, flagged. */
function KeyField({
  label,
  value,
  next = null,
  truncate = true,
}: {
  label: string
  value: string | null
  next?: string | null
  truncate?: boolean
}) {
  const render = (v: string) =>
    truncate ? (
      <Hash value={v} />
    ) : (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="hash break-all">{v}</span>
        <CopyButton value={v} label="Copy" />
      </span>
    )
  const rotating = next != null && next !== value
  return (
    <Field label={label}>
      {value == null ? <Muted>—</Muted> : render(value)}
      {rotating && (
        <div className="mt-1 flex items-center gap-1.5 text-[0.7rem]">
          <span className="text-primary shrink-0 tracking-wider uppercase">→ next epoch</span>
          <span className="text-muted min-w-0">{render(next)}</span>
        </div>
      )}
    </Field>
  )
}

/** The expanded detail under a validator row: identity + staking pool, the
 *  current/next-epoch economic parameters, project metadata, and a toggle-able
 *  "keys & network" block (consensus pubkeys, worker keys, multiaddrs) plus a
 *  copy-the-whole-validator-as-json affordance. */
function ValidatorDetail({
  v,
  referenceGasPrice,
}: {
  v: ValidatorSummary
  referenceGasPrice: bigint
}) {
  const [showPool, setShowPool] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  // The detail always shows the current gas price (with its next-epoch value via
  // the arrow), so the outlier flag is judged on the current value here.
  const gasOutlier = isGasOutlier(v.gasPrice, referenceGasPrice)
  const gasTitle =
    gasOutlier && referenceGasPrice > 0n
      ? `${(Number(v.gasPrice) / Number(referenceGasPrice)).toFixed(1)}× the reference gas price (${referenceGasPrice.toLocaleString()} MIST) — drastically off the network rate`
      : 'gas price (MIST)'
  // SUI value of one pool token = stake / pool tokens. Grows as rewards accrue,
  // so `(rate − 1)` is the lifetime reward yield of the pool since activation.
  // (`Number()` on ~1e16 MIST loses sub-token precision, immaterial to a ratio.)
  const rate = v.poolTokens > 0n ? Number(v.stake) / Number(v.poolTokens) : null
  return (
    <div className="border-line bg-bg space-y-5 border-t px-3 py-4">
      <FieldGrid cols={3}>
        <Field label="address">
          <LinkedHash value={v.address} />
        </Field>
        <Field label="staking pool">
          {v.stakingPoolId ? <Hash value={v.stakingPoolId} /> : <Muted>—</Muted>}
        </Field>
        <Field label="voting power">
          <span className="text-text tabular-nums">
            {pct(v.votingPower)}
            <span className="text-muted ml-1.5 text-[0.7rem]">
              {v.votingPower.toLocaleString()} bps
            </span>
          </span>
        </Field>
        <Field label="stake">
          <HoverCard card={stakeCard(v)} className="text-text tabular-nums">
            {formatSui(v.stake)}
            {v.nextEpochStake !== v.stake && (
              <NextEpoch>{formatSuiCompact(v.nextEpochStake)}</NextEpoch>
            )}
          </HoverCard>
        </Field>
        <Field label="commission">
          <span className="text-text tabular-nums">
            {pct(v.commissionRate)}
            {v.nextEpochCommissionRate !== v.commissionRate && (
              <NextEpoch>{pct(v.nextEpochCommissionRate)}</NextEpoch>
            )}
          </span>
        </Field>
        <Field label="gas price">
          <span className={cn('tabular-nums', gasOutlier ? 'text-danger' : 'text-text')} title={gasTitle}>
            {v.gasPrice.toLocaleString()}
            {v.nextEpochGasPrice !== v.gasPrice && (
              <NextEpoch>{v.nextEpochGasPrice.toLocaleString()}</NextEpoch>
            )}
          </span>
        </Field>
        <Field label="rewards pool">
          <span className="text-text tabular-nums">{formatSui(v.rewardsPool)}</span>
        </Field>
        <Field label="reports">
          <span
            className={cn('tabular-nums', v.reportCount > 0 ? 'text-danger' : 'text-text')}
            title="other validators reporting this one this epoch"
          >
            {v.reportCount}
          </span>
        </Field>
        <Field label="project">
          {v.projectUrl ? (
            <a
              href={v.projectUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={v.projectUrl}
              className="text-primary flex min-w-0 items-center gap-1 hover:underline"
            >
              <span className="truncate">
                {v.projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </span>
              <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : (
            <Muted>—</Muted>
          )}
        </Field>
      </FieldGrid>
      {v.description && (
        <p className="text-muted max-w-prose text-xs leading-relaxed">{v.description}</p>
      )}

      <div className="border-line space-y-4 border-t pt-4">
        <div className="space-y-3">
          <CollapseToggle
            open={showPool}
            onToggle={() => setShowPool((s) => !s)}
            label="staking pool"
          />
          {showPool && (
            <FieldGrid cols={3}>
              <Field label="exchange rate">
                <span
                  className="text-text tabular-nums"
                  title={
                    rate == null
                      ? undefined
                      : `${((rate - 1) * 100).toFixed(2)}% rewards accrued since the pool activated`
                  }
                >
                  {rate == null ? <Muted>—</Muted> : `${rate.toFixed(4)} SUI / token`}
                </span>
              </Field>
              <Field label="pool tokens">
                <span className="text-text tabular-nums" title="total staking-pool token supply">
                  {formatTokenAmount(v.poolTokens, 9)}
                </span>
              </Field>
              <Field label="activation epoch">
                <span className="text-text tabular-nums">{v.activationEpoch ?? '—'}</span>
              </Field>
              <Field label="pending stake">
                <span className="text-text tabular-nums" title="SUI queued to stake next epoch">
                  {formatSui(v.pendingStake)}
                </span>
              </Field>
              <Field label="pending withdraw">
                <span className="text-text tabular-nums" title="SUI queued to withdraw next epoch">
                  {formatSui(v.pendingSuiWithdraw)}
                </span>
              </Field>
              <Field label="deactivation epoch">
                {v.deactivationEpoch != null ? (
                  <span className="text-danger tabular-nums">{v.deactivationEpoch}</span>
                ) : (
                  <Muted>—</Muted>
                )}
              </Field>
            </FieldGrid>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <CollapseToggle
            open={showKeys}
            onToggle={() => setShowKeys((s) => !s)}
            label="keys & network"
          />
          <CopyJsonButton value={v.raw} title="copy this validator's full on-chain json" />
        </div>
        {showKeys && (
          <FieldGrid cols={2}>
            <KeyField label="protocol pubkey" value={v.protocolPubkey} next={v.nextProtocolPubkey} />
            <KeyField label="network pubkey" value={v.networkPubkey} next={v.nextNetworkPubkey} />
            <KeyField label="worker pubkey" value={v.workerPubkey} next={v.nextWorkerPubkey} />
            <KeyField
              label="proof of possession"
              value={v.proofOfPossession}
              next={v.nextProofOfPossession}
            />
            <KeyField label="operation cap" value={v.operationCapId} />
            <KeyField
              label="net address"
              value={v.netAddress}
              next={v.nextNetAddress}
              truncate={false}
            />
            <KeyField
              label="p2p address"
              value={v.p2pAddress}
              next={v.nextP2pAddress}
              truncate={false}
            />
            <KeyField
              label="primary address"
              value={v.primaryAddress}
              next={v.nextPrimaryAddress}
              truncate={false}
            />
            <KeyField
              label="worker address"
              value={v.workerAddress}
              next={v.nextWorkerAddress}
              truncate={false}
            />
          </FieldGrid>
        )}
      </div>
    </div>
  )
}
