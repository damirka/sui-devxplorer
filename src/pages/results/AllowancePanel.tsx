import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { AddressLink } from '@/components/ui/AddressLink'
import { CoinIcon } from '@/components/ui/CoinIcon'
import { TypeLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { useNow } from '@/lib/useNow'
import { fetchBalancesForTypes, formatCoinAmount, useCoinMetas, type CoinMeta } from '@/lib/coin'
import { describeInstant, formatAgo, formatSpan } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  rateLimitWindow,
  rateLimitWindowText,
  type AllowanceData,
  type AllowanceRateLimit,
} from '@/lib/allowance'
import { AllowanceStatusBadge } from './AllowanceBadge'

/**
 * The decoded view of an `0x2::allowance::Allowance` — shown in place of the
 * dynamic-fields pane, which an allowance never has. Everything a spender or
 * funder wants at a glance: who funds whom for which coin, how much of the
 * lifetime cap is left, where the rate-limit window stands right now (the
 * on-chain `spent` is only updated on a charge, so the window is recomputed
 * against the clock), the validity bounds, and whether the funder's address
 * balance can actually cover the remainder. Only the clock-bound readouts
 * tick; the rest of the panel renders once.
 */
export function AllowancePanel({
  allowance: a,
  revoked = false,
}: {
  allowance: AllowanceData
  /** The object is gone — a revoked allowance's last-known settings. */
  revoked?: boolean
}) {
  const { network } = useNetwork()
  const meta = useCoinMetas(network, [a.coinType]).get(a.coinType ?? '')
  const amount = (v: bigint) => formatCoinAmount(v, meta)

  // Spends debit the funder's *address balance* (the accumulator), not its coin
  // objects — so that's the figure that decides whether a spend can succeed.
  const { data: funderBalances } = useAsync(
    (signal) =>
      a.coinType && !revoked
        ? fetchBalancesForTypes(network, a.funder, [a.coinType], signal)
        : Promise.resolve(null),
    [network, a.funder, a.coinType, revoked],
  )
  const funderBalance = funderBalances?.[0]?.inAccumulator ?? null
  const remaining = a.lifetimeCap != null ? a.lifetimeCap - a.currentSpend : null
  const underfunded =
    funderBalance != null && remaining != null && remaining > 0n && BigInt(funderBalance) < remaining

  return (
    <Panel>
      <PanelSection
        label="Allowance"
        action={revoked ? <AllowanceStatusBadge allowance={a} revoked /> : <LiveStatusBadge allowance={a} />}
      >
        <FieldGrid cols={3}>
          <Field label="Name">
            {a.name ? (
              <span className="text-text font-mono text-sm break-all">{a.name}</span>
            ) : (
              <Muted>—</Muted>
            )}
          </Field>
          <Field label="Currency">
            {a.coinType ? (
              <span className="flex flex-wrap items-center gap-2">
                <CoinIcon url={meta?.iconUrl} symbol={meta?.symbol} className="h-4 w-4" />
                <TypeLink type={a.coinType} />
              </span>
            ) : (
              <Muted>—</Muted>
            )}
          </Field>
          <Field label="App">
            {a.app ? (
              <TypeLink type={a.app} />
            ) : (
              <span className="text-muted font-mono text-sm">none · signer path</span>
            )}
          </Field>
          <Field label="Funder">
            <AddressLink value={a.funder} />
          </Field>
          <Field label="Spender">
            {a.spender ? <AddressLink value={a.spender} /> : <Muted>—</Muted>}
          </Field>
          <Field label="Funder balance">
            {revoked ? (
              <Muted>—</Muted>
            ) : funderBalance == null ? (
              <Muted>…</Muted>
            ) : (
              <span
                className={cn('font-mono text-sm tabular-nums', underfunded ? 'text-danger' : 'text-text')}
                title={
                  underfunded
                    ? 'the funder’s address balance is below what this allowance still permits — a spend larger than the balance fails'
                    : 'the funder’s address balance (the accumulator spends draw from)'
                }
              >
                {amount(BigInt(funderBalance))}
                {underfunded && <span className="ml-2">· underfunded</span>}
              </span>
            )}
          </Field>
        </FieldGrid>

        <div className="border-line mt-5 flex flex-col gap-4 border-t pt-4 font-mono text-xs">
          <Limit label="lifetime">
            {a.lifetimeCap != null ? (
              <Meter
                spent={a.currentSpend}
                limit={a.lifetimeCap}
                text={`${amount(a.currentSpend)} of ${amount(a.lifetimeCap)} spent · ${amount(remaining ?? 0n)} left`}
              />
            ) : (
              <span className="text-text">
                no lifetime cap · {amount(a.currentSpend)} spent so far
              </span>
            )}
          </Limit>
          <Limit label="rate limit">
            {a.rateLimit ? (
              <RateLimitLine rl={a.rateLimit} meta={meta} live={!revoked} />
            ) : (
              <Muted>none</Muted>
            )}
          </Limit>
          <Limit label="valid">
            <ValidityLine allowance={a} live={!revoked} />
          </Limit>
        </div>
      </PanelSection>
    </Panel>
  )
}

/** A once-a-second clock for the readouts that move; a revoked allowance's
 *  are frozen, so those tick hourly (effectively never). */
function useClock(live: boolean): number {
  return useNow(live ? 1000 : 3_600_000)
}

function LiveStatusBadge({ allowance }: { allowance: AllowanceData }) {
  const now = useClock(true)
  return <AllowanceStatusBadge allowance={allowance} now={now} />
}

/** One limit row: a fixed-width lowercase label, then its readout. */
function Limit({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
      <span className="text-muted w-24 shrink-0 tracking-wide uppercase">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** A spent-of-limit bar with its readout beneath. Full = the alarm hue. */
function Meter({ spent, limit, text }: { spent: bigint; limit: bigint; text: string }) {
  const pct = limit > 0n ? Number((spent * 10_000n) / limit) / 100 : 0
  const full = spent >= limit
  return (
    <div className="flex flex-col gap-1.5">
      <div className="bg-surface-2 h-1.5 w-full max-w-md" title={`${pct.toFixed(1)}% of the cap spent`}>
        <div
          className={cn('h-full', full ? 'bg-danger' : 'bg-primary')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={cn('tabular-nums', full ? 'text-danger' : 'text-text')}>{text}</span>
    </div>
  )
}

function ValidityLine({ allowance: a, live }: { allowance: AllowanceData; live: boolean }) {
  const now = useClock(live)
  return (
    <span className="text-text">
      {a.startMs != null ? (
        <span title={describeInstant(a.startMs, now)}>
          {a.startMs > now ? `from ${formatSpan(a.startMs - now)} from now` : 'since start'}
        </span>
      ) : (
        'immediately'
      )}
      <span className="text-muted"> → </span>
      {a.expirationMs != null ? (
        <span title={describeInstant(a.expirationMs, now)}>
          {a.expirationMs > now
            ? `expires in ${formatSpan(a.expirationMs - now)}`
            : `expired ${formatAgo(now - a.expirationMs)}`}
        </span>
      ) : (
        'no expiration'
      )}
    </span>
  )
}

function RateLimitLine({
  rl,
  meta,
  live,
}: {
  rl: AllowanceRateLimit
  meta: CoinMeta | undefined
  live: boolean
}) {
  const now = useClock(live)
  const w = rateLimitWindow(rl, now)
  const left = rl.limit - w.spent
  const amount = (v: bigint) => formatCoinAmount(v, meta)
  return (
    <div className="flex flex-col gap-1.5">
      <Meter
        spent={w.spent}
        limit={rl.limit}
        text={`${amount(rl.limit)} ${rateLimitWindowText(rl.window)} · ${amount(w.spent)} spent this window · ${amount(left > 0n ? left : 0n)} left`}
      />
      <span className="text-muted">
        {w.resetsAtMs != null ? (
          <span title={describeInstant(w.resetsAtMs, now)}>
            window resets in {formatSpan(Math.max(0, w.resetsAtMs - now))}
          </span>
        ) : (
          'windows anchor on the first spend'
        )}
      </span>
    </div>
  )
}
