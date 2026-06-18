import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { TypeLink } from '@/components/ui/links'
import { Muted } from '@/components/ui/Field'
import { CoinIcon } from '@/components/ui/CoinIcon'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchBalances,
  fetchBalancesForTypes,
  fetchCoinMetadata,
  type CoinBalance,
  type CoinMeta,
} from '@/lib/coin'
import { formatTokenAmount } from '@/lib/format'
import { normalizeSuiId } from '@/lib/search'

/** The native gas coin's full type repr (the form the service returns). */
const SUI_TYPE = normalizeSuiId('2') + '::sui::SUI'

/**
 * The standard coins, pinned to the top in this order. They're fetched directly
 * by their canonical type — so they always show first regardless of where they'd
 * fall in the (server-ordered, paginated) full balance list — and a same-symbol
 * look-alike can never take their spot.
 */
const STANDARD_TYPES = [
  SUI_TYPE,
  '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  '0x255b9db92dc4b602c8b7930d558e8474f571ba192c77323bf2da3ad2fefe7e08::usdc::USDC',
  '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS',
]
const STANDARD_SET = new Set(STANDARD_TYPES)

/** Grouped raw integer — fallback when a coin's decimals aren't known. */
function rawBalance(raw: string): string {
  try {
    return BigInt(raw).toLocaleString('en-US')
  } catch {
    return raw
  }
}

/**
 * An owner's coin balances, aggregated per coin type (`fetchBalances` sums them
 * server-side). The standard coins (SUI, WAL, USDC, NS) are fetched separately by
 * exact type and pinned to the top — then filtered out of the paginated list
 * below so they're never shown twice. The aggregate `total` is the headline;
 * a tag says where the balance lives (coin objects, the address accumulator, or
 * both), with the split spelled out when it's mixed. Amounts are scaled by each
 * coin's decimals + symbol (one bulk metadata request).
 */
export function Balances({
  id,
  hideWhenEmpty = false,
}: {
  id: string
  hideWhenEmpty?: boolean
}) {
  const { network } = useNetwork()
  const pager = useCursorPager(`${network}|${id}`)
  const [open, setOpen] = useState(true)

  // Always fetch the standard coins by exact type so they pin to the top no
  // matter how deep they'd be in the paginated full list. Independent of the
  // pager, so it's fetched once per owner.
  const { data: standardData, loading: standardLoading } = useAsync(
    (signal) => fetchBalancesForTypes(network, id, STANDARD_TYPES, signal),
    [network, id],
  )
  const standard = standardData ?? []

  // Everything else, server-ordered + paginated, with the standard coins
  // filtered out so they're not listed twice.
  const { data: pageData, loading: pageLoading, error } = useAsync(
    (signal) =>
      fetchBalances(network, id, { first: pager.pageSize, after: pager.after }, signal),
    [network, id, pager.pageSize, pager.after],
  )
  // Pin the standard coins, in STANDARD_TYPES order. Source them from the
  // dedicated by-type fetch (which reaches coins sitting deep in the paginated
  // list) AND, as a fallback, from the current page — so a slow or failed
  // standard fetch (e.g. under heavy page load) can't make SUI silently vanish
  // or drop out of the top. Zero balances are skipped everywhere.
  const pinnedByType = new Map<string, CoinBalance>()
  for (const r of standard) {
    if (r.total !== '0') pinnedByType.set(r.coinType, r)
  }
  for (const r of pageData?.balances ?? []) {
    if (STANDARD_SET.has(r.coinType) && r.total !== '0' && !pinnedByType.has(r.coinType)) {
      pinnedByType.set(r.coinType, r)
    }
  }
  const pinned = STANDARD_TYPES.map((t) => pinnedByType.get(t)).filter(
    (r): r is CoinBalance => !!r,
  )

  // Everything else (non-standard, non-zero), in the service's order.
  const rest = (pageData?.balances ?? []).filter(
    (r) => !STANDARD_SET.has(r.coinType) && r.total !== '0',
  )
  // Pin only on the first page; deeper pages are just the paginated remainder.
  const rows: CoinBalance[] = pager.pageIndex === 0 ? [...pinned, ...rest] : rest

  const types = rows.map((r) => r.coinType)
  const { data: meta } = useAsync(
    (signal) =>
      types.length
        ? fetchCoinMetadata(network, types, signal)
        : Promise.resolve(new Map<string, CoinMeta>()),
    [network, types.join(',')],
  )

  const loading = standardLoading || pageLoading
  const paged = pager.pageIndex > 0 || !!pageData?.hasNextPage

  if (
    hideWhenEmpty &&
    !loading &&
    !error &&
    rows.length === 0 &&
    !pageData?.hasNextPage
  ) {
    return null
  }

  return (
    <Panel>
      <PanelSection
        label={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? 'collapse' : 'expand'}
            className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="panel-label">Balances</span>
          </button>
        }
        action={
          // Pager only when expanded; the count stays visible either way so a
          // collapsed panel still tells you how many coins are shown.
          open && paged ? (
            <Pager
              pageIndex={pager.pageIndex}
              pageSize={pager.pageSize}
              onPageSize={pager.setPageSize}
              hasNext={!!pageData?.hasNextPage}
              onPrev={pager.prev}
              onNext={() => pager.next(pageData?.endCursor ?? null)}
              label="coin types"
            />
          ) : rows.length > 0 ? (
            <span className="text-muted font-mono text-xs">{rows.length}</span>
          ) : undefined
        }
      >
        {open &&
          (loading ? (
            <SkeletonLines count={3} />
          ) : error ? (
            <span className="text-danger font-mono text-xs">{error.message}</span>
          ) : rows.length > 0 ? (
            <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
              {rows.map((r) => {
                const m = meta?.get(r.coinType)
                const full = (raw: string) =>
                  m ? formatTokenAmount(raw, m.decimals, m.symbol) : rawBalance(raw)
                const bare = (raw: string) =>
                  m ? formatTokenAmount(raw, m.decimals) : rawBalance(raw)
                const hasCoins = r.inCoins !== '0'
                const hasAddr = r.inAccumulator !== '0'
                // Where this balance lives: classic `Coin<T>` objects, the
                // address accumulator (the newer model), or a mix of both.
                const source =
                  hasCoins && hasAddr
                    ? 'coins + accumulator'
                    : hasAddr
                      ? 'accumulator'
                      : 'coins'
                // Spell out the amounts only when it's genuinely split — the tag
                // alone already says it all for a pure coin/address balance.
                const mixed = hasCoins && hasAddr
                return (
                  <li
                    key={r.coinType}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <CoinIcon url={m?.iconUrl} symbol={m?.symbol} />
                      <span className="min-w-0 break-all">
                        <TypeLink type={r.coinType} />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="border-line text-muted shrink-0 border px-1.5 py-px text-[0.625rem] tracking-wider uppercase"
                          title="where this balance is held"
                        >
                          {source}
                        </span>
                        <span className="text-text">{full(r.total)}</span>
                      </span>
                      {mixed && (
                        <span className="text-muted text-[0.6875rem] tracking-wide">
                          coins {bare(r.inCoins)} · accumulator {bare(r.inAccumulator)}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Muted>no coin balances.</Muted>
          ))}
      </PanelSection>
    </Panel>
  )
}
