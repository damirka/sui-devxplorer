import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AtSign, Coins, Images, KeyRound, Loader2, Lock, Package, Stamp, X } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorText } from '@/components/ui/ErrorText'
import { Badge } from '@/components/ui/Badge'
import { CoinIcon } from '@/components/ui/CoinIcon'
import { LinkedHash, TypeLink, useValidatorHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchOwnedPage,
  fetchOwnedPublishers,
  fetchOwnedUpgradeCaps,
  type OwnedObject,
  type OwnedPublisher,
  type OwnedUpgradeCapNode,
} from '@/lib/object'
import { emptyPage } from '@/lib/pagination'
import {
  fetchCoinMetadata,
  fetchCoinObjectBalances,
  type CoinMeta,
} from '@/lib/coin'
import { resolveMvrType } from '@/lib/mvr'
import {
  fetchOwnedSuinsNames,
  isSuinsType,
  SUINS_REGISTRATION_MVR,
  type OwnedSuinsName,
} from '@/lib/suins'
import { fetchOwnedStakedSui, isStakedSuiType, type OwnedStakedSui } from '@/lib/staking'
import { fetchValidatorPools, type ValidatorRef } from '@/lib/validators'
import { isUpgradeCapType } from '@/lib/upgradeCap'
import { formatSui, formatType, formatTokenAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Network } from '@/context/network-context'
import {
  toCapRows,
  useUpgradeCapPackageNames,
  UpgradeCapRow,
} from './OwnedUpgradeCaps'

/** The top-level struct name of a type repr — the base before any generics, so
 * `0x2::coin::Coin<0x..::x::FooCap>` → `Coin`, `0x..::m::AdminCap<T>` → `AdminCap`. */
function topLevelStructName(repr: string): string | null {
  const base = repr.split('<', 1)[0]
  const parts = base.split('::')
  return parts.length === 3 ? parts[2] : null
}

/** A capability object: a top-level type whose struct name ends in `Cap`
 * (`AdminCap`, `UpgradeCap`, `TreasuryCap`, …). A `Cap` buried in a generic
 * argument (e.g. `Coin<…Cap>`) is deliberately NOT matched — only the outer
 * struct counts. */
function isCapabilityType(repr: string | null | undefined): boolean {
  if (!repr) return false
  const name = topLevelStructName(repr)
  return !!name && name.endsWith('Cap')
}

/** The inner type `INNER` of a `0x2::coin::Coin<INNER>` repr, or null when the
 * type isn't a coin. `0x2` is matched in any zero-padded form. */
function coinInnerType(repr: string | null | undefined): string | null {
  if (!repr) return null
  const m = /^0x0*2::coin::Coin<(.+)>$/.exec(repr)
  return m ? m[1] : null
}


/** The Move Registry app-registration capability (`app_record::AppCap`): owning
 * one means you control a registered MVR app/package name. Matched by
 * `module::struct` so the (defining) package id counts on any network — on
 * mainnet that's `0x62c1f5b1…::app_record::AppCap`. */
function isMvrAppType(repr: string | null | undefined): boolean {
  return !!repr && /::app_record::AppCap$/.test(repr)
}

/** The `0x2::package::Publisher` framework type (same id on every network). */
function isPublisherType(repr: string | null | undefined): boolean {
  return !!repr && /^0x0*2::package::Publisher$/.test(repr)
}

/** A Display object's displayed type `T` and whether it's the legacy
 * `0x2::display::Display<T>` (vs the newer `0x2::display_registry::Display<T>`).
 * Null if the repr isn't a Display. */
function displayInner(
  repr: string | null | undefined,
): { inner: string; legacy: boolean } | null {
  const reg = /^0x0*2::display_registry::Display<(.+)>$/.exec(repr ?? '')
  if (reg) return { inner: reg[1], legacy: false }
  const legacy = /^0x0*2::display::Display<(.+)>$/.exec(repr ?? '')
  if (legacy) return { inner: legacy[1], legacy: true }
  return null
}

/** The active right-pane filter: one concrete type, or a synthetic view that
 * spans a family of types owned — capabilities (`*Cap`), coins (`Coin<*>`),
 * displays (`Display<*>`), or publishers. */
type Filter =
  | { kind: 'type'; type: string }
  | { kind: 'capabilities' }
  | { kind: 'coins' }
  | { kind: 'displays' }
  | { kind: 'publishers' }
  | { kind: 'staked' }
  | null

/** Collapse whitespace and clamp to `max` chars with an ellipsis — keeps a
 * long display description from dominating its row (full text stays in `title`). */
function clampText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

/** A SuiNS name's expiry as a short date + whether it's already past. */
function suinsExpiry(ms: number | null): { text: string; expired: boolean } {
  if (ms == null) return { text: '—', expired: false }
  const text = new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
  return { text, expired: ms < Date.now() }
}

export function OwnedObjects({
  id,
  hideWhenEmpty = false,
}: {
  id: string
  /** Render nothing while the id owns no objects — for pages (e.g. a deleted /
   *  wrapped object) where the panel is only worth showing if it has content. */
  hideWhenEmpty?: boolean
}) {
  const { network } = useNetwork()
  const [filter, setFilter] = useState<Filter>(null)
  // The ownership scan lives here (not in `TypesOwned`) so its by-product — the
  // capability objects — is available to the list pane for the CAPABILITIES view.
  const scan = useOwnedTypeScan(network, id)

  // Resolve the SuiNS registration type for this network via MVR — gives the
  // correct defining-package id on mainnet/testnet without hardcoding. null on
  // devnet / if MVR is down (the SUINS filter then falls back to the scan's repr).
  const { data: suinsType } = useAsync(
    (signal) => resolveMvrType(network, SUINS_REGISTRATION_MVR, signal),
    [network],
  )

  // Clear the filter when the owner or network changes.
  useEffect(() => setFilter(null), [id, network])

  // Self-hide when asked and the id owns nothing (stays hidden through the scan —
  // it only pops in once something is found, no empty flash).
  if (hideWhenEmpty && scan.total === 0 && !scan.error) return null

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <TypesOwned
        scan={scan}
        filter={filter}
        suinsType={suinsType ?? null}
        onSelectType={(t) =>
          setFilter((f) =>
            f?.kind === 'type' && f.type === t ? null : { kind: 'type', type: t },
          )
        }
        onSelectCapabilities={() =>
          setFilter((f) => (f?.kind === 'capabilities' ? null : { kind: 'capabilities' }))
        }
        onSelectCoins={() =>
          setFilter((f) => (f?.kind === 'coins' ? null : { kind: 'coins' }))
        }
        onSelectDisplays={() =>
          setFilter((f) => (f?.kind === 'displays' ? null : { kind: 'displays' }))
        }
        onSelectPublishers={() =>
          setFilter((f) => (f?.kind === 'publishers' ? null : { kind: 'publishers' }))
        }
        onSelectStaked={() =>
          setFilter((f) => (f?.kind === 'staked' ? null : { kind: 'staked' }))
        }
      />
      <OwnedList
        network={network}
        id={id}
        filter={filter}
        capabilities={scan.caps}
        coins={scan.coins}
        displays={scan.displays}
        onClearFilter={() => setFilter(null)}
      />
    </div>
  )
}

/* ── right pane: the selected type, or the capabilities view ─────────── */

/** The clear-filter chip shown above a filtered list. */
function FilterChip({
  label,
  title,
  onClear,
}: {
  label: string
  title: string
  onClear: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="border-line text-muted hover:text-primary mb-3 inline-flex max-w-full items-center gap-1.5 border px-2 py-1 font-mono text-xs transition-colors"
      title={`clear filter: ${title}`}
    >
      <span className="hash truncate">{label}</span>
      <X size={12} className="shrink-0" />
    </button>
  )
}

/** A pre-built, full-width filter toggle (COINS / CAPABILITIES) above the
 * per-type list. Active = highlighted; the count sits on the right. */
function QuickFilter({
  icon,
  label,
  count,
  active,
  onClick,
  title,
}: {
  icon: ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-2 border px-3 py-2 font-mono text-xs tracking-wide uppercase transition-colors',
        active
          ? 'border-primary bg-surface-2 text-primary'
          : 'border-line text-text hover:border-primary hover:text-primary',
      )}
      title={title}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-muted">{count}</span>
    </button>
  )
}

/** Sort owned objects by a string key, then by address — so like objects group
 *  while staying stable. */
function sortOwned(
  objs: OwnedObject[],
  key: (o: OwnedObject) => string,
): OwnedObject[] {
  return [...objs].sort(
    (a, b) => key(a).localeCompare(key(b)) || a.address.localeCompare(b.address),
  )
}

/** A scan-sourced row: object id → the (clickable) type it carries, with an
 *  optional inline badge (`extra`) and a right-aligned `trailing` slot (e.g. a
 *  coin value). Shared by the capabilities / coins / displays views, which
 *  differ only in which type they surface and what trails it. */
function OwnedScanRow({
  index,
  address,
  type,
  extra,
  trailing,
}: {
  index: number
  address: string
  type: string | null
  extra?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <RowIndex n={index} />
      <span className="shrink-0">
        <LinkedHash value={address} />
      </span>
      {type && (
        <span className="text-muted flex min-w-0 flex-1 items-center gap-2 break-all">
          <TypeLink type={type} />
          {extra}
        </span>
      )}
      {trailing}
    </li>
  )
}

/** A stake's validator: the name linked to the validators dashboard once the
 *  pool → validator map resolves, else the raw pool id as an object link — for
 *  stakes whose pool isn't in the active set, or until the map loads. */
function StakeValidator({
  validator,
  poolId,
  href,
}: {
  validator: ValidatorRef | null
  poolId: string | null
  href: (address: string) => string
}) {
  if (validator) {
    return (
      <Link
        to={href(validator.address)}
        title={`staked with ${validator.name} — view validator`}
        className="text-primary min-w-0 truncate hover:underline"
      >
        {validator.name}
      </Link>
    )
  }
  if (poolId) {
    return (
      <span
        className="text-muted inline-flex min-w-0 items-center gap-1.5"
        title="staking pool"
      >
        pool <LinkedHash value={poolId} />
      </span>
    )
  }
  return null
}

/** A coin object's value as the row's trailing chip: its icon + the formatted
 *  amount. Nothing until the balance has loaded. */
function coinValueNode(info: { value: string | null; meta?: CoinMeta }): ReactNode {
  if (info.value == null) return undefined
  return (
    <span
      className="text-text inline-flex shrink-0 items-center gap-1.5 tabular-nums"
      title="coin value"
    >
      <CoinIcon url={info.meta?.iconUrl} symbol={info.meta?.symbol} className="h-4 w-4" />
      {info.value}
    </span>
  )
}

/**
 * Per-object coin values for a list of owned objects: each coin object's raw
 * balance (by id) plus its coin metadata (decimals/symbol/icon), returned as a
 * lookup `object → { value, meta }`. Reuses the same scaling as the Balances
 * panel; `value` is `null` for non-coins and until that object's balance loads.
 *
 * The caches *accumulate* — only ids/types not seen yet are fetched, and results
 * merge in. That matters for the COINS quick filter, whose object set grows as
 * the background ownership scan pages in: values appear incrementally and never
 * blank out (a plain refetch-on-change would clear them on every scan tick).
 */
function useCoinValues(
  network: Network,
  objects: OwnedObject[],
): (o: OwnedObject) => { value: string | null; meta?: CoinMeta } {
  const [balances, setBalances] = useState<Map<string, string>>(() => new Map())
  const [meta, setMeta] = useState<Map<string, CoinMeta>>(() => new Map())

  // Caches are network-scoped — drop them when the network changes.
  useEffect(() => {
    setBalances(new Map())
    setMeta(new Map())
  }, [network])

  const ids = useMemo(
    () => objects.filter((o) => coinInnerType(o.type)).map((o) => o.address),
    [objects],
  )
  const innerTypes = useMemo(
    () => [
      ...new Set(
        objects.map((o) => coinInnerType(o.type)).filter((t): t is string => !!t),
      ),
    ],
    [objects],
  )

  // Fetch only the balances we don't already hold, then merge them in.
  const missingBalanceIds = ids.filter((id) => !balances.has(id))
  const missingBalanceKey = missingBalanceIds.join(',')
  useEffect(() => {
    if (!missingBalanceKey) return
    const controller = new AbortController()
    fetchCoinObjectBalances(network, missingBalanceKey.split(','), controller.signal)
      .then((m) => {
        if (!controller.signal.aborted && m.size) {
          setBalances((prev) => new Map([...prev, ...m]))
        }
      })
      .catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, missingBalanceKey])

  // Same for metadata, keyed by coin type.
  const missingTypes = innerTypes.filter((t) => !meta.has(t))
  const missingTypesKey = missingTypes.join(',')
  useEffect(() => {
    if (!missingTypesKey) return
    const controller = new AbortController()
    fetchCoinMetadata(network, missingTypesKey.split(','), controller.signal)
      .then((m) => {
        if (!controller.signal.aborted && m.size) {
          setMeta((prev) => new Map([...prev, ...m]))
        }
      })
      .catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, missingTypesKey])

  return (o: OwnedObject) => {
    const inner = coinInnerType(o.type)
    if (!inner) return { value: null }
    const m = meta.get(inner)
    const raw = balances.get(o.address)
    // No registered metadata → show the grouped raw integer (decimals = 0).
    const value =
      raw == null
        ? null
        : m
          ? formatTokenAmount(raw, m.decimals, m.symbol)
          : formatTokenAmount(raw, 0)
    return { value, meta: m }
  }
}

function OwnedList({
  network,
  id,
  filter,
  capabilities,
  coins,
  displays,
  onClearFilter,
}: {
  network: Network
  id: string
  filter: Filter
  /** Capability objects gathered by the scan (for the CAPABILITIES view). */
  capabilities: OwnedObject[]
  /** Coin objects gathered by the scan (for the COINS view). */
  coins: OwnedObject[]
  /** Display objects gathered by the scan (for the DISPLAYS view). */
  displays: OwnedObject[]
  onClearFilter: () => void
}) {
  const showCaps = filter?.kind === 'capabilities'
  const showCoins = filter?.kind === 'coins'
  const showDisplays = filter?.kind === 'displays'
  const showPublishers = filter?.kind === 'publishers'
  const showStaked = filter?.kind === 'staked'
  const typeFilter = filter?.kind === 'type' ? filter.type : null
  // UpgradeCaps get the richer cap formatting (governed package + policy) used
  // by the "UpgradeCaps held" panel — a different fetch (it needs contents.json).
  const caps = !!typeFilter && isUpgradeCapType(typeFilter)
  // The SuiNS-names view fetches the full set with each name's expiry and sorts
  // it (soonest first), so it owns its own fetch rather than the paged one below.
  const suinsFilter = !!typeFilter && isSuinsType(typeFilter)
  // Capabilities / coins / displays come straight from the in-memory ownership
  // scan; only the (non-suins) type-filtered, cap, and publisher views hit the
  // shared paged fetch.
  const fetched = (!!typeFilter && !suinsFilter) || showPublishers

  // SuiNS names — all of them, with expiry, sorted ascending. Disabled (empty)
  // unless the suins filter is active.
  const suinsNames = useAsync(
    (signal) =>
      suinsFilter && typeFilter
        ? fetchOwnedSuinsNames(network, id, typeFilter, signal)
        : Promise.resolve<OwnedSuinsName[]>([]),
    [network, id, typeFilter, suinsFilter],
  )

  // StakedSui receipts — the full set with pool + principal, largest first. Its
  // own fetch (it needs each object's contents), enabled only when active.
  const staked = useAsync(
    (signal) =>
      showStaked
        ? fetchOwnedStakedSui(network, id, signal)
        : Promise.resolve<OwnedStakedSui[]>([]),
    [network, id, showStaked],
  )
  // Lean pool → validator lookup, so each stake names the validator it's with
  // (rather than a raw pool id). Loads in parallel; rows fall back to the pool id
  // for stakes whose pool isn't in the active set (or until this resolves).
  const validatorPools = useAsync(
    (signal) =>
      showStaked ? fetchValidatorPools(network, signal) : Promise.resolve(null),
    [network, showStaked],
  )
  const poolToValidator = validatorPools.data
  const validatorHref = useValidatorHref()

  // One paginated fetch, switched by the active view. The pager key carries the
  // view, so switching filters resets pagination (and clears the prior result,
  // keeping the union-typed `items` honest to the current branch).
  const list = usePagedList<OwnedObject | OwnedUpgradeCapNode | OwnedPublisher>(
    `${network}|${id}|${typeFilter ?? filter?.kind ?? ''}`,
    (args, signal) => {
      if (showPublishers) return fetchOwnedPublishers(network, id, args, signal)
      if (caps) return fetchOwnedUpgradeCaps(network, id, args, signal)
      if (typeFilter)
        return fetchOwnedPage(
          network,
          id,
          { ...args, type: typeFilter, display: true },
          signal,
        )
      return Promise.resolve(emptyPage())
    },
    { enabled: fetched },
  )

  // Cap rows + their MVR names. The names hook must run every render, so derive
  // from a (possibly empty) list when the cap view isn't the active one.
  const capRows = toCapRows(caps ? (list.items as OwnedUpgradeCapNode[]) : [])
  const capNames = useUpgradeCapPackageNames(network, capRows)

  // Scan-sourced rows, grouped so like objects sit together.
  const capabilityRows = sortOwned(capabilities, (o) => o.type ?? '')
  const coinRows = sortOwned(coins, (o) => coinInnerType(o.type) ?? '')
  // Displays: newer registry Displays first, then legacy, each by displayed type.
  const displayRows = [...displays].sort((a, b) => {
    const da = displayInner(a.type)
    const db = displayInner(b.type)
    return (
      Number(da?.legacy ?? false) - Number(db?.legacy ?? false) ||
      (da?.inner ?? '').localeCompare(db?.inner ?? '') ||
      a.address.localeCompare(b.address)
    )
  })

  // Coin views — the COINS quick filter, or a selected `Coin<T>` type — show
  // each object's value; other views just show id + type. The value lookup runs
  // over whichever coin objects are on screen.
  const coinTypeFilter = !!typeFilter && coinInnerType(typeFilter) != null
  const displayedCoins: OwnedObject[] = showCoins
    ? coinRows
    : coinTypeFilter
      ? (list.items as OwnedObject[])
      : []
  const coinValue = useCoinValues(network, displayedCoins)

  const sectionLabel = showCaps
    ? 'Capabilities'
    : showCoins
      ? 'Coins'
      : showDisplays
        ? 'Displays'
        : showPublishers
          ? 'Publishers'
          : showStaked
            ? 'Staked SUI'
            : suinsFilter
              ? 'SuiNS names'
              : 'Owned objects'

  // Row count shown for the in-memory views; the pager drives the fetched ones.
  const scanCount = showCaps
    ? capabilityRows.length
    : showCoins
      ? coinRows.length
      : showDisplays
        ? displayRows.length
        : null

  // The clear-filter chip: the trimmed type for a type filter (full id in the
  // tooltip), otherwise the synthetic view's name.
  const chipLabel = typeFilter
    ? formatType(typeFilter)
    : showCaps
      ? 'capabilities'
      : showCoins
        ? 'coins'
        : showDisplays
          ? 'displays'
          : showStaked
            ? 'staked sui'
            : 'publishers'
  const chipTitle = typeFilter ?? chipLabel

  return (
    <Panel className="min-w-0">
      <PanelSection
        label={sectionLabel}
        action={
          fetched ? (
            list.paged ? <Pager {...list.pagerProps} label="objects" /> : undefined
          ) : suinsFilter ? (
            <span className="text-muted font-mono text-xs">
              {(suinsNames.data ?? []).length}
            </span>
          ) : showStaked ? (
            <span className="text-muted font-mono text-xs">
              {(staked.data ?? []).length}
            </span>
          ) : scanCount != null ? (
            <span className="text-muted font-mono text-xs">{scanCount}</span>
          ) : undefined
        }
      >
        {!filter ? (
          <EmptyState title="no filter selected">
            pick a quick filter, or select a type from the list, to list the
            objects owned here.
          </EmptyState>
        ) : (
          <>
            <FilterChip label={chipLabel} title={chipTitle} onClear={onClearFilter} />

            {showCaps ? (
              <DataList
                loading={false}
                error={null}
                items={capabilityRows}
                empty="no capabilities held."
                scroll
              >
                {(o, i) => (
                  <OwnedScanRow
                    key={o.address}
                    index={i + 1}
                    address={o.address}
                    type={o.type}
                  />
                )}
              </DataList>
            ) : showCoins ? (
              <DataList
                loading={false}
                error={null}
                items={coinRows}
                empty="no coins held."
                scroll
              >
                {(o, i) => (
                  <OwnedScanRow
                    key={o.address}
                    index={i + 1}
                    address={o.address}
                    type={coinInnerType(o.type)}
                    trailing={coinValueNode(coinValue(o))}
                  />
                )}
              </DataList>
            ) : showDisplays ? (
              <DataList
                loading={false}
                error={null}
                items={displayRows}
                empty="no displays held."
                scroll
              >
                {(o, i) => {
                  const d = displayInner(o.type)
                  return (
                    <OwnedScanRow
                      key={o.address}
                      index={i + 1}
                      address={o.address}
                      type={d?.inner ?? null}
                      extra={
                        d?.legacy ? (
                          <Badge tone="muted" className="shrink-0">
                            legacy
                          </Badge>
                        ) : undefined
                      }
                    />
                  )
                }}
              </DataList>
            ) : showPublishers ? (
              <DataList
                loading={list.loading}
                error={list.error}
                items={list.items as OwnedPublisher[]}
                empty="no publishers held."
                scroll
              >
                {(p, i) => (
                  <li
                    key={p.address}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                  >
                    <RowIndex n={i + 1} />
                    <LinkedHash value={p.address} />
                    <span className="text-muted shrink-0" title="is publisher for">
                      →
                    </span>
                    {p.package ? (
                      <LinkedHash value={p.package} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {p.moduleName && (
                      <span className="text-muted shrink-0">· {p.moduleName}</span>
                    )}
                  </li>
                )}
              </DataList>
            ) : showStaked ? (
              <DataList
                loading={staked.loading}
                error={staked.error}
                items={staked.data ?? []}
                empty="no staked SUI held."
                scroll
              >
                {(s, i) => {
                  const validator = s.poolId ? poolToValidator?.get(s.poolId) : null
                  return (
                    <li
                      key={s.address}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                    >
                      <RowIndex n={i + 1} />
                      <LinkedHash value={s.address} />
                      <Badge className="shrink-0">staked sui</Badge>
                      <StakeValidator
                        validator={validator ?? null}
                        poolId={s.poolId}
                        href={validatorHref}
                      />
                      <span
                        className="text-text ml-auto shrink-0 tabular-nums"
                        title="principal staked"
                      >
                        {formatSui(s.principal)}
                      </span>
                    </li>
                  )
                }}
              </DataList>
            ) : suinsFilter ? (
              <DataList
                loading={suinsNames.loading}
                error={suinsNames.error}
                items={suinsNames.data ?? []}
                empty="no suins names held."
                scroll
              >
                {(o, i) => {
                  const e = suinsExpiry(o.expirationMs)
                  return (
                    <li key={o.address} className="flex items-center gap-3 py-2.5">
                      <RowIndex n={i + 1} />
                      <LinkedHash value={o.address} />
                      {o.domain && (
                        <span className="text-text min-w-0 truncate">{o.domain}</span>
                      )}
                      <span
                        className={cn(
                          'ml-auto shrink-0 tabular-nums',
                          e.expired ? 'text-danger' : 'text-muted',
                        )}
                        title={e.expired ? 'expired' : 'expiration date'}
                      >
                        {e.expired ? `expired ${e.text}` : e.text}
                      </span>
                    </li>
                  )
                }}
              </DataList>
            ) : caps ? (
              <DataList
                loading={list.loading}
                error={list.error}
                items={capRows}
                empty="no owned objects of this type."
                scroll
              >
                {(r, i) => (
                  <UpgradeCapRow
                    key={r.id}
                    row={r}
                    mvrName={r.package ? capNames[r.package] : undefined}
                    n={i + 1}
                  />
                )}
              </DataList>
            ) : (
              <DataList
                loading={list.loading}
                error={list.error}
                items={list.items as OwnedObject[]}
                empty="no owned objects of this type."
                scroll
              >
                {(o, i) =>
                  coinTypeFilter ? (
                    <OwnedScanRow
                      key={o.address}
                      index={i + 1}
                      address={o.address}
                      type={coinInnerType(o.type)}
                      trailing={coinValueNode(coinValue(o))}
                    />
                  ) : (
                    <li key={o.address} className="flex items-center gap-3 py-2.5">
                      <RowIndex n={i + 1} />
                      <LinkedHash value={o.address} />
                      {(o.name || o.description) && (
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={[o.name, o.description].filter(Boolean).join(' — ')}
                        >
                          {o.name && <span className="text-text">{o.name}</span>}
                          {o.name && o.description && (
                            <span className="text-muted"> · </span>
                          )}
                          {o.description && (
                            <span className="text-muted">
                              {clampText(o.description, 48)}
                            </span>
                          )}
                        </span>
                      )}
                    </li>
                  )
                }
              </DataList>
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  )
}

/* ── background full-ownership scan → unique types + capabilities ────── */

/** Cap the automatic scan: an owner can hold tens of thousands of objects, and
 * walking every page to build the type breakdown hammers the API for data the
 * user may not need in full. Stop here and let them opt into the rest. */
const SCAN_CAP = 1000

interface ScanState {
  types: { type: string; count: number }[]
  /** Every capability object seen during the scan (a `*Cap` top-level type). */
  caps: OwnedObject[]
  /** Every coin object seen during the scan (a `0x2::coin::Coin<*>` type). */
  coins: OwnedObject[]
  /** Every Display object seen (`0x2::display[_registry]::Display<*>`). */
  displays: OwnedObject[]
  total: number
  done: boolean
  /** Stopped at `SCAN_CAP` with more pages remaining — the breakdown is partial. */
  capped: boolean
  error: string | null
}

type OwnedScan = ScanState & { loadAll: () => void }

function useOwnedTypeScan(network: Network, id: string): OwnedScan {
  const [state, setState] = useState<ScanState>({
    types: [],
    caps: [],
    coins: [],
    displays: [],
    total: 0,
    done: false,
    capped: false,
    error: null,
  })
  // Flipped once the user opts into a full scan; re-runs the effect uncapped.
  const [unbounded, setUnbounded] = useState(false)

  // A new owner starts capped again.
  useEffect(() => setUnbounded(false), [network, id])

  useEffect(() => {
    const controller = new AbortController()
    setState({
      types: [],
      caps: [],
      coins: [],
      displays: [],
      total: 0,
      done: false,
      capped: false,
      error: null,
    })

    const counts = new Map<string, number>()
    const caps: OwnedObject[] = []
    const coins: OwnedObject[] = []
    const displays: OwnedObject[] = []
    let total = 0
    let after: string | null = null

    void (async () => {
      try {
        for (;;) {
          const page = await fetchOwnedPage(
            network,
            id,
            { limit: 50, cursor: after },
            controller.signal,
          )
          for (const o of page.items) {
            total++
            const t = o.type ?? '(unknown)'
            counts.set(t, (counts.get(t) ?? 0) + 1)
            if (isCapabilityType(o.type)) caps.push(o)
            if (coinInnerType(o.type)) coins.push(o)
            if (displayInner(o.type)) displays.push(o)
          }
          if (controller.signal.aborted) return
          // Stop early once we've counted enough — unless the user asked for all.
          const capped = !unbounded && total >= SCAN_CAP && page.hasNextPage
          const types = [...counts.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
          setState({
            types,
            caps: [...caps],
            coins: [...coins],
            displays: [...displays],
            total,
            done: !page.hasNextPage || capped,
            capped,
            error: null,
          })
          if (!page.hasNextPage || capped) break
          after = page.endCursor
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setState((s) => ({
          ...s,
          done: true,
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    })()

    return () => controller.abort()
  }, [network, id, unbounded])

  return { ...state, loadAll: () => setUnbounded(true) }
}

function TypesOwned({
  scan,
  filter,
  suinsType,
  onSelectType,
  onSelectCapabilities,
  onSelectCoins,
  onSelectDisplays,
  onSelectPublishers,
  onSelectStaked,
}: {
  scan: OwnedScan
  filter: Filter
  /** SuiNS registration type for this network (MVR-resolved), or null. */
  suinsType: string | null
  onSelectType: (type: string) => void
  onSelectCapabilities: () => void
  onSelectCoins: () => void
  onSelectDisplays: () => void
  onSelectPublishers: () => void
  onSelectStaked: () => void
}) {
  const { types, caps, coins, displays, total, done, capped, error, loadAll } = scan
  const [filterText, setFilterText] = useState('')
  const q = filterText.trim().toLowerCase()
  // SuiNS is a single concrete type, so its pre-built filter just selects it (the
  // type-filtered list then renders each registration's `.sui` name via Display).
  const suinsTypes = types.filter((t) => isSuinsType(t.type))
  const suinsCount = suinsTypes.reduce((sum, t) => sum + t.count, 0)
  // Prefer the MVR-resolved canonical type; fall back to the repr the scan saw
  // (the same id in practice) so the button works even before MVR resolves.
  const suinsFilterType = suinsType ?? suinsTypes[0]?.type ?? null
  // Publishers are a single concrete type (`0x2` is universal — no MVR needed);
  // count them from the scan's type breakdown.
  const publisherCount = types
    .filter((t) => isPublisherType(t.type))
    .reduce((sum, t) => sum + t.count, 0)
  // StakedSui receipts — a single concrete type (0x3 is universal), counted from
  // the scan; the filter opens a dedicated view (pool + principal per stake).
  const stakedCount = types
    .filter((t) => isStakedSuiType(t.type))
    .reduce((sum, t) => sum + t.count, 0)
  // MVR packages are AppCap objects — one per registered Move Registry app name.
  // A single concrete type, so (like suins names) the filter just selects it; use
  // the scan-seen repr so it's the network-correct defining id, no hardcoding.
  const mvrTypes = types.filter((t) => isMvrAppType(t.type))
  const mvrCount = mvrTypes.reduce((sum, t) => sum + t.count, 0)
  const mvrFilterType = mvrTypes[0]?.type ?? null
  // The pre-built filters are shortcuts only — their types stay in the full list
  // too, since dropping them empties it for a coin-/cap-/suins-heavy owner.
  const shown = q
    ? types.filter((t) => t.type.toLowerCase().includes(q))
    : types

  return (
    <Panel>
      <PanelSection
        label="Types owned"
        action={
          <span className="text-muted inline-flex items-center gap-1.5 font-mono text-xs">
            {!done && <Loader2 size={12} className="animate-spin" />}
            {done
              ? capped
                ? `${types.length} types · first ${total} objects`
                : `${types.length} types · ${total} objects`
              : `scanning… ${total}`}
          </span>
        }
      >
        {error ? (
          <ErrorText error={error} />
        ) : types.length > 0 ? (
          <>
            {/* Pre-built quick filters — one-click shortcuts to common holdings. */}
            {(coins.length > 0 ||
              suinsCount > 0 ||
              mvrCount > 0 ||
              publisherCount > 0 ||
              stakedCount > 0 ||
              displays.length > 0 ||
              caps.length > 0) && (
              <div className="mb-3 flex flex-col gap-2">
                {coins.length > 0 && (
                  <QuickFilter
                    icon={<Coins size={13} />}
                    label="coins"
                    count={coins.length}
                    active={filter?.kind === 'coins'}
                    onClick={onSelectCoins}
                    title="all 0x2::coin::Coin objects owned here"
                  />
                )}
                {suinsCount > 0 && suinsFilterType && (
                  <QuickFilter
                    icon={<AtSign size={13} />}
                    label="suins names"
                    count={suinsCount}
                    active={filter?.kind === 'type' && isSuinsType(filter.type)}
                    onClick={() => onSelectType(suinsFilterType)}
                    title="all SuiNS name registrations owned here"
                  />
                )}
                {mvrCount > 0 && mvrFilterType && (
                  <QuickFilter
                    icon={<Package size={13} />}
                    label="mvr packages"
                    count={mvrCount}
                    active={filter?.kind === 'type' && isMvrAppType(filter.type)}
                    onClick={() => onSelectType(mvrFilterType)}
                    title="all Move Registry app registrations (AppCap) owned here"
                  />
                )}
                {publisherCount > 0 && (
                  <QuickFilter
                    icon={<Stamp size={13} />}
                    label="publishers"
                    count={publisherCount}
                    active={filter?.kind === 'publishers'}
                    onClick={onSelectPublishers}
                    title="all 0x2::package::Publisher objects owned here"
                  />
                )}
                {stakedCount > 0 && (
                  <QuickFilter
                    icon={<Lock size={13} />}
                    label="staked sui"
                    count={stakedCount}
                    active={filter?.kind === 'staked'}
                    onClick={onSelectStaked}
                    title="all 0x3::staking_pool::StakedSui objects owned here"
                  />
                )}
                {displays.length > 0 && (
                  <QuickFilter
                    icon={<Images size={13} />}
                    label="displays"
                    count={displays.length}
                    active={filter?.kind === 'displays'}
                    onClick={onSelectDisplays}
                    title="all 0x2::display Display<T> objects owned here"
                  />
                )}
                {caps.length > 0 && (
                  <QuickFilter
                    icon={<KeyRound size={13} />}
                    label="capabilities"
                    count={caps.length}
                    active={filter?.kind === 'capabilities'}
                    onClick={onSelectCapabilities}
                    title="all *Cap capability objects owned here"
                  />
                )}
              </div>
            )}

            {capped && (
              <div className="border-line bg-surface-2 mb-3 flex flex-wrap items-center justify-between gap-2 border px-2.5 py-2 font-mono text-xs">
                <span className="text-muted">
                  too many objects — types cover the first{' '}
                  {total.toLocaleString()} only.
                </span>
                <button
                  type="button"
                  onClick={loadAll}
                  className="text-primary shrink-0 hover:underline"
                  title="scan every owned object (may be slow)"
                >
                  load all
                </button>
              </div>
            )}
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="filter types"
              spellCheck={false}
              aria-label="filter owned types"
              className="input mb-3 !py-1.5 !text-xs"
            />
            {shown.length > 0 ? (
              <ul className="divide-line max-h-72 divide-y overflow-y-auto font-mono text-xs">
                {shown.map((t) => {
                  const active = filter?.kind === 'type' && filter.type === t.type
                  return (
                    <li key={t.type}>
                      <button
                        type="button"
                        onClick={() => onSelectType(t.type)}
                        aria-pressed={active}
                        className={cn(
                          'flex w-full items-center justify-between gap-4 px-2 py-2 text-left transition-colors',
                          active
                            ? 'bg-surface-2 text-primary'
                            : 'text-muted hover:bg-surface-2 hover:text-primary',
                        )}
                        title={t.type}
                      >
                        <span className="hash break-all">{formatType(t.type)}</span>
                        <span className="shrink-0">{t.count}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <span className="text-muted text-sm">
                no types match “{filterText}”.
              </span>
            )}
          </>
        ) : done ? (
          <span className="text-muted text-sm">no owned objects.</span>
        ) : (
          <SkeletonLines count={3} />
        )}
      </PanelSection>
    </Panel>
  )
}
