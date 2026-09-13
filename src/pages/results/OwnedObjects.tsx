import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AtSign,
  CircleArrowUp,
  Coins,
  ExternalLink,
  HandCoins,
  Images,
  KeyRound,
  Loader2,
  Lock,
  Package,
  Stamp,
  X,
} from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorText } from '@/components/ui/ErrorText'
import { Badge } from '@/components/ui/Badge'
import { TabButton } from '@/components/ui/TabButton'
import { CoinIcon } from '@/components/ui/CoinIcon'
import { EntityLink, LinkedHash, TypeLink, useValidatorHref } from '@/components/ui/links'
import { AddressLink } from '@/components/ui/AddressLink'
import { MenuRow } from '@/components/ui/MenuRow'
import { useNetwork } from '@/context/useNetwork'
import type { Network } from '@/context/network-context'
import { useAsync } from '@/lib/useAsync'
import { useDeepLinkScroll } from '@/lib/useDeepLinkScroll'
import {
  fetchAllOwnedUpgradeCaps,
  fetchOwnedMvrApps,
  fetchOwnedPage,
  fetchOwnedPublishers,
  type OwnedMvrApp,
  type OwnedObject,
  type OwnedPublisher,
} from '@/lib/object'
import {
  fetchCoinMetadata,
  fetchCoinObjectBalances,
  formatCoinAmount,
  useCoinMetas,
  type CoinMeta,
} from '@/lib/coin'
import { mvrAppUrl, resolveMvrNamesBulk, resolveMvrType } from '@/lib/mvr'
import { fetchOwnedSuinsNames, isSuinsType, SUINS_REGISTRATION_MVR, type OwnedSuinsName } from '@/lib/suins'
import { fetchOwnedStakedSui, isStakedSuiType, type OwnedStakedSui } from '@/lib/staking'
import { fetchChainStatus } from '@/lib/chain'
import {
  ALLOWANCE_STATUS_ORDER,
  fetchOwnedAllowances,
  isAllowanceCapType,
  ownedAllowanceStatus,
  type OwnedAllowance,
} from '@/lib/allowance'
import { AllowanceStatusBadge } from './AllowanceBadge'
import { fetchValidatorPools, type ValidatorRef } from '@/lib/validators'
import { isUpgradeCapType, policyLabel } from '@/lib/upgradeCap'
import { formatNumber, formatSui, formatTokenAmount, formatType } from '@/lib/format'
import { cn } from '@/lib/cn'
import { toCapRows, useUpgradeCapPackageNames, UpgradeCapRow, type CapRow } from './OwnedUpgradeCaps'

/* ── type predicates ─────────────────────────────────────────────────────── */

/** The top-level struct name of a type repr — the base before any generics, so
 * `0x2::coin::Coin<0x..::x::FooCap>` → `Coin`, `0x..::m::AdminCap<T>` → `AdminCap`. */
function topLevelStructName(repr: string): string | null {
  const base = repr.split('<', 1)[0]
  const parts = base.split('::')
  return parts.length === 3 ? parts[2] : null
}

/** A capability object: a top-level type whose struct name ends in `Cap`
 * (`AdminCap`, `TreasuryCap`, …) and that no dedicated view claims — an
 * `UpgradeCap` or `AllowanceCap` lives in its own view, not here. A `Cap`
 * buried in a generic argument (e.g. `Coin<…Cap>`) is deliberately NOT
 * matched — only the outer struct counts. */
function isCapabilityType(repr: string | null | undefined): boolean {
  if (!repr) return false
  const name = topLevelStructName(repr)
  return !!name && name.endsWith('Cap') && dedicatedViewFor(repr) == null
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

/* ── the view registry ───────────────────────────────────────────────────── */

/** The named views of the pane — each a quick filter in TYPES OWNED and a
 *  rendering of its own. Everything else is a plain type picked from the list. */
type ViewKind =
  | 'coins'
  | 'suins'
  | 'mvr'
  | 'upgradecaps'
  | 'publishers'
  | 'staked'
  | 'allowances'
  | 'displays'
  | 'capabilities'

interface ViewSpec {
  kind: ViewKind
  /** The pane title. */
  label: string
  /** The quick-filter and clear-chip label (lowercase, terminal register). */
  chip: string
  /** The quick-filter tooltip. */
  title: string
  icon: ReactNode
  /** The concrete types this view owns — the quick-filter count comes from the
   *  scan's breakdown, and picking such a type from the list opens this view.
   *  Null for the views over a scan-collected family (coins, displays, caps). */
  match: ((repr: string) => boolean) | null
}

/** Every named view, in quick-filter order. A type belongs to at most one. */
const VIEWS: ViewSpec[] = [
  {
    kind: 'coins',
    label: 'Coins',
    chip: 'coins',
    title: 'all 0x2::coin::Coin objects owned here',
    icon: <Coins size={13} />,
    match: null,
  },
  {
    kind: 'suins',
    label: 'SuiNS names',
    chip: 'suins names',
    title: 'all SuiNS name registrations owned here',
    icon: <AtSign size={13} />,
    match: isSuinsType,
  },
  {
    kind: 'mvr',
    label: 'MVR packages',
    chip: 'mvr packages',
    title: 'all Move Registry app registrations (AppCap) owned here',
    icon: <Package size={13} />,
    match: isMvrAppType,
  },
  {
    kind: 'upgradecaps',
    label: 'Upgrade caps',
    chip: 'upgrade caps',
    title: 'all 0x2::package::UpgradeCap objects owned here — the packages this address can upgrade',
    icon: <CircleArrowUp size={13} />,
    match: isUpgradeCapType,
  },
  {
    kind: 'publishers',
    label: 'Publishers',
    chip: 'publishers',
    title: 'all 0x2::package::Publisher objects owned here',
    icon: <Stamp size={13} />,
    match: isPublisherType,
  },
  {
    kind: 'staked',
    label: 'Staked SUI',
    chip: 'staked sui',
    title: 'all 0x3::staking_pool::StakedSui objects owned here',
    icon: <Lock size={13} />,
    match: isStakedSuiType,
  },
  {
    kind: 'allowances',
    label: 'Allowances',
    chip: 'allowances',
    title: 'allowances this address funds — one per 0x2::allowance::AllowanceCap held',
    icon: <HandCoins size={13} />,
    match: isAllowanceCapType,
  },
  {
    kind: 'displays',
    label: 'Displays',
    chip: 'displays',
    title: 'all 0x2::display Display<T> objects owned here',
    icon: <Images size={13} />,
    match: null,
  },
  {
    kind: 'capabilities',
    label: 'Capabilities',
    chip: 'capabilities',
    title: 'all *Cap capability objects owned here',
    icon: <KeyRound size={13} />,
    match: null,
  },
]
const VIEW_BY_KIND = new Map(VIEWS.map((v) => [v.kind, v]))
function viewSpec(kind: ViewKind): ViewSpec {
  return VIEW_BY_KIND.get(kind)!
}

/** The named view a concrete type opens, if any. */
function dedicatedViewFor(repr: string | null | undefined): ViewKind | null {
  if (!repr) return null
  return VIEWS.find((v) => v.match?.(repr))?.kind ?? null
}

/** The active right-pane view: a named view, or one concrete type from the
 *  list. Normalized — a type that a named view owns is that view. */
type Filter = { kind: ViewKind } | { kind: 'type'; type: string } | null

function normalizeFilter(f: Filter): Filter {
  if (f?.kind !== 'type') return f
  const kind = dedicatedViewFor(f.type)
  return kind ? { kind } : f
}

function sameFilter(a: Filter, b: Filter): boolean {
  if (!a || !b) return a === b
  return a.kind === b.kind && (a.kind !== 'type' || b.kind !== 'type' || a.type === b.type)
}

/** The `?owned=` pin for a view: a named view's key, or `type:<repr>`. */
function serializeFilter(f: Filter): string | null {
  if (!f) return null
  return f.kind === 'type' ? `type:${f.type}` : f.kind
}

function parseFilter(raw: string | null): Filter {
  if (!raw) return null
  if (raw.startsWith('type:')) return normalizeFilter({ kind: 'type', type: raw.slice(5) })
  return VIEW_BY_KIND.has(raw as ViewKind) ? { kind: raw as ViewKind } : null
}

/**
 * The pane's state lives in the URL — the view in `?owned=`, its status facet
 * in `?facet=` — so it survives a reload, is part of a bookmark or shared link,
 * and comes back with the browser's back button after opening a row. Both are
 * pins: links to other ids drop them (`PIN_PARAMS`). Selecting a view (or
 * toggling it off) is the one write path, and it always clears the facet.
 */
function useOwnedView() {
  const [params, setParams] = useSearchParams()
  const filter = parseFilter(params.get('owned'))
  const facet = params.get('facet')
  const select = (next: Filter) =>
    setParams((p) => {
      const out = new URLSearchParams(p)
      const pin = serializeFilter(normalizeFilter(next))
      if (pin) out.set('owned', pin)
      else out.delete('owned')
      out.delete('facet')
      return out
    })
  return {
    filter,
    facet,
    /** Select a view, or clear it when it's the active one. */
    toggle: (next: Filter) => select(sameFilter(filter, normalizeFilter(next)) ? null : next),
    clear: () => select(null),
    setFacet: (key: string | null) =>
      setParams((p) => {
        const out = new URLSearchParams(p)
        if (key) out.set('facet', key)
        else out.delete('facet')
        return out
      }),
  }
}

/** What every view in the pane needs from its host: the facet state and the
 *  clear action. */
const PaneContext = createContext<{
  facet: string | null
  setFacet: (key: string | null) => void
  clear: () => void
}>({ facet: null, setFacet: () => {}, clear: () => {} })

/* ── the panel ───────────────────────────────────────────────────────────── */

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
  const view = useOwnedView()
  // The ownership scan lives here (not in `TypesOwned`) so its by-products —
  // the coin / display / capability objects — feed the scan-backed views.
  const scan = useOwnedTypeScan(network, id)

  // Arriving with a pinned view (a bookmark, a shared link, or back from a
  // row): bring the panel into view, and keep it there while the panels above
  // are still landing. Not gated on the scan — a large owner's scan can outlast
  // the anchoring, and the section is on the page from the first render.
  const rootRef = useRef<HTMLDivElement>(null)
  const [arrivedPinned] = useState(() => view.filter != null)
  useDeepLinkScroll(rootRef, arrivedPinned)

  // Resolve the SuiNS registration type for this network via MVR — gives the
  // correct defining-package id on mainnet/testnet without hardcoding. null on
  // devnet / if MVR is down (the view then falls back to the scan's repr).
  const { data: suinsType } = useAsync(
    (signal) => resolveMvrType(network, SUINS_REGISTRATION_MVR, signal),
    [network],
  )

  // Self-hide when asked and the id owns nothing (stays hidden through the scan —
  // it only pops in once something is found, no empty flash).
  if (hideWhenEmpty && scan.total === 0 && !scan.error) return null

  return (
    <div id="owned" ref={rootRef} className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <TypesOwned scan={scan} filter={view.filter} onToggle={view.toggle} />
      <PaneContext.Provider value={{ facet: view.facet, setFacet: view.setFacet, clear: view.clear }}>
        <OwnedPane
          network={network}
          id={id}
          filter={view.filter}
          scan={scan}
          suinsType={suinsType ?? null}
        />
      </PaneContext.Provider>
    </div>
  )
}

/* ── right pane: one component per view ──────────────────────────────────── */

/** Mount the active view — and only it, so each view's fetches, lookups, and
 *  facets run exactly when it's on screen. */
function OwnedPane({
  network,
  id,
  filter,
  scan,
  suinsType,
}: {
  network: Network
  id: string
  filter: Filter
  scan: OwnedScan
  /** SuiNS registration type for this network (MVR-resolved), or null. */
  suinsType: string | null
}) {
  if (!filter) {
    return (
      <PaneShell label="Owned objects">
        <EmptyState title="no filter selected">
          pick a quick filter, or select a type from the list, to list the
          objects owned here.
        </EmptyState>
      </PaneShell>
    )
  }
  const scanType = (match: (repr: string) => boolean) =>
    scan.types.find((t) => match(t.type))?.type ?? null
  switch (filter.kind) {
    case 'type':
      return <TypeView network={network} id={id} type={filter.type} />
    case 'coins':
      return <CoinsView network={network} coins={scan.coins} />
    case 'capabilities':
      return <CapabilitiesView caps={scan.caps} />
    case 'displays':
      return <DisplaysView displays={scan.displays} />
    case 'publishers':
      return <PublishersView network={network} id={id} />
    case 'suins':
      // Prefer the MVR-resolved canonical type; fall back to the repr the scan
      // saw (the same id in practice) so the view works before MVR resolves.
      return <SuinsView network={network} id={id} type={suinsType ?? scanType(isSuinsType)} />
    case 'mvr':
      return <MvrAppsView network={network} id={id} type={scanType(isMvrAppType)} />
    case 'upgradecaps':
      return <UpgradeCapsView network={network} id={id} />
    case 'staked':
      return <StakedView network={network} id={id} />
    case 'allowances':
      return <AllowancesView network={network} id={id} />
  }
}

/** The pane frame every view shares: title, the count or pager on the right,
 *  the clear-filter chip, then the body. */
function PaneShell({
  label,
  action,
  chip,
  children,
}: {
  label: string
  action?: ReactNode
  /** The clear chip — the view's name, or a type (its full repr in the tooltip). */
  chip?: { label: string; title?: string }
  children: ReactNode
}) {
  const pane = useContext(PaneContext)
  return (
    <Panel className="min-w-0">
      <PanelSection label={label} action={action}>
        {chip && <FilterChip label={chip.label} title={chip.title ?? chip.label} onClear={pane.clear} />}
        {children}
      </PanelSection>
    </Panel>
  )
}

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

function Count({ n }: { n: number }) {
  return <span className="text-muted font-mono text-xs">{n}</span>
}

/**
 * A view over a full, in-memory set (the scan's families, or a fetch that
 * drains every page): the count on the right, status facets when the view has
 * a status function, then the rows. Filtering by facet is client-side — status
 * lives in Move contents the API can't filter on — and free, since every row
 * is already here.
 */
function FullSetView<T>({
  spec,
  items,
  loading = false,
  error = null,
  empty,
  statusOf,
  facetOrder = [],
  renderRow,
}: {
  spec: ViewSpec
  items: T[]
  loading?: boolean
  error?: Error | null
  empty: string
  /** Each row's status bucket; omit for a view without facets. */
  statusOf?: (item: T) => string
  /** The buckets' display order. */
  facetOrder?: readonly string[]
  renderRow: (item: T, index: number) => ReactNode
}) {
  const pane = useContext(PaneContext)
  const split = statusOf ? facetize(items, statusOf, facetOrder, pane.facet) : null
  return (
    <PaneShell label={spec.label} chip={{ label: spec.chip }} action={<Count n={items.length} />}>
      {split && split.total > 0 && (
        <FacetStrip
          facets={split.facets}
          total={split.total}
          active={split.active}
          onSelect={pane.setFacet}
        />
      )}
      <DataList loading={loading} error={error} items={split?.items ?? items} empty={empty} scroll>
        {renderRow}
      </DataList>
    </PaneShell>
  )
}

/** One status bucket of a faceted view and how many rows fall in it. */
interface Facet {
  key: string
  count: number
}

/** Bucket a view's rows by status in one pass: the facets present (in `order`,
 *  with counts), and the rows the `active` facet keeps — all of them when no
 *  facet is active, or when the URL names one that isn't present. */
function facetize<T>(
  items: T[],
  statusOf: (item: T) => string,
  order: readonly string[],
  requested: string | null,
): { facets: Facet[]; items: T[]; total: number; active: string | null } {
  const buckets = new Map<string, T[]>()
  for (const it of items) {
    const k = statusOf(it)
    const bucket = buckets.get(k)
    if (bucket) bucket.push(it)
    else buckets.set(k, [it])
  }
  const active = requested != null && buckets.has(requested) ? requested : null
  return {
    facets: order.filter((k) => buckets.has(k)).map((k) => ({ key: k, count: buckets.get(k)!.length })),
    items: active ? buckets.get(active)! : items,
    total: items.length,
    active,
  }
}

/** The status facets of a full-set view as a tab strip — `all`, then one tab
 * per status present, each with its count. The active tab filters the rows;
 * clicking it again clears. */
function FacetStrip({
  facets,
  total,
  active,
  onSelect,
}: {
  facets: Facet[]
  total: number
  active: string | null
  onSelect: (key: string | null) => void
}) {
  return (
    <div className="border-line mb-3 flex flex-wrap gap-1 border-b">
      <TabButton active={active === null} onClick={() => onSelect(null)}>
        all <span className="text-muted">{total}</span>
      </TabButton>
      {facets.map((f) => (
        <TabButton
          key={f.key}
          active={active === f.key}
          onClick={() => onSelect(active === f.key ? null : f.key)}
        >
          {f.key} <span className="text-muted">{f.count}</span>
        </TabButton>
      ))}
    </div>
  )
}

/** A view over a server-paged connection: the pager on the right, then the rows. */
function PagedView<T>({
  label,
  chip,
  list,
  empty,
  renderRow,
}: {
  label: string
  chip: { label: string; title?: string }
  list: ReturnType<typeof usePagedList<T>>
  empty: string
  renderRow: (item: T, index: number) => ReactNode
}) {
  return (
    <PaneShell
      label={label}
      chip={chip}
      action={list.paged ? <Pager {...list.pagerProps} label="objects" /> : undefined}
    >
      <DataList loading={list.loading} error={list.error} items={list.items} empty={empty} scroll>
        {renderRow}
      </DataList>
    </PaneShell>
  )
}

/* ── the views ───────────────────────────────────────────────────────────── */

/** Sort owned objects by a string key, then by address — so like objects group
 *  while staying stable. */
function sortOwned(objs: OwnedObject[], key: (o: OwnedObject) => string): OwnedObject[] {
  return [...objs].sort(
    (a, b) => key(a).localeCompare(key(b)) || a.address.localeCompare(b.address),
  )
}

/** One concrete type from the list, server-paged. A `Coin<T>` type shows each
 *  object's value; anything else its Display name and description. */
function TypeView({ network, id, type }: { network: Network; id: string; type: string }) {
  const list = usePagedList<OwnedObject>(`${network}|${id}|type:${type}`, (args, signal) =>
    fetchOwnedPage(network, id, { ...args, type, display: true }, signal),
  )
  const coinType = coinInnerType(type)
  const coinValue = useCoinValues(network, coinType ? list.items : NO_OBJECTS)
  return (
    <PagedView
      label="Owned objects"
      chip={{ label: formatType(type), title: type }}
      list={list}
      empty="no owned objects of this type."
      renderRow={(o, i) =>
        coinType ? (
          <OwnedScanRow
            key={o.address}
            index={i + 1}
            address={o.address}
            type={coinType}
            trailing={coinValueNode(coinValue(o))}
          />
        ) : (
          <DisplayRow
            key={o.address}
            n={i + 1}
            address={o.address}
            name={o.name}
            description={o.description}
          />
        )
      }
    />
  )
}
const NO_OBJECTS: OwnedObject[] = []

/** Every coin object the scan saw, grouped by coin type, each with its value. */
function CoinsView({ network, coins }: { network: Network; coins: OwnedObject[] }) {
  const rows = useMemo(() => sortOwned(coins, (o) => coinInnerType(o.type) ?? ''), [coins])
  const coinValue = useCoinValues(network, rows)
  return (
    <FullSetView
      spec={viewSpec('coins')}
      items={rows}
      empty="no coins held."
      renderRow={(o, i) => (
        <OwnedScanRow
          key={o.address}
          index={i + 1}
          address={o.address}
          type={coinInnerType(o.type)}
          trailing={coinValueNode(coinValue(o))}
        />
      )}
    />
  )
}

/** Every `*Cap` object the scan saw, grouped by type. */
function CapabilitiesView({ caps }: { caps: OwnedObject[] }) {
  const rows = useMemo(() => sortOwned(caps, (o) => o.type ?? ''), [caps])
  return (
    <FullSetView
      spec={viewSpec('capabilities')}
      items={rows}
      empty="no capabilities held."
      renderRow={(o, i) => (
        <OwnedScanRow key={o.address} index={i + 1} address={o.address} type={o.type} />
      )}
    />
  )
}

/** Every Display object the scan saw: registry Displays first, then legacy,
 *  each by the type it displays. */
function DisplaysView({ displays }: { displays: OwnedObject[] }) {
  const rows = useMemo(
    () =>
      [...displays].sort((a, b) => {
        const da = displayInner(a.type)
        const db = displayInner(b.type)
        return (
          Number(da?.legacy ?? false) - Number(db?.legacy ?? false) ||
          (da?.inner ?? '').localeCompare(db?.inner ?? '') ||
          a.address.localeCompare(b.address)
        )
      }),
    [displays],
  )
  return (
    <FullSetView
      spec={viewSpec('displays')}
      items={rows}
      empty="no displays held."
      renderRow={(o, i) => {
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
    />
  )
}

/** The `Publisher` objects held, server-paged: each → the package + module it
 *  was claimed from. */
function PublishersView({ network, id }: { network: Network; id: string }) {
  const spec = viewSpec('publishers')
  const list = usePagedList<OwnedPublisher>(`${network}|${id}|publishers`, (args, signal) =>
    fetchOwnedPublishers(network, id, args, signal),
  )
  return (
    <PagedView
      label={spec.label}
      chip={{ label: spec.chip }}
      list={list}
      empty="no publishers held."
      renderRow={(p, i) => (
        <MenuRow key={p.address} n={i + 1} wrap>
          <LinkedHash value={p.address} />
          <span className="text-muted shrink-0" title="is publisher for">
            →
          </span>
          {p.package ? <LinkedHash value={p.package} /> : <span className="text-muted">—</span>}
          {p.moduleName && <span className="text-muted shrink-0">· {p.moduleName}</span>}
        </MenuRow>
      )}
    />
  )
}

/** Every SuiNS registration held, with its expiry, soonest first; faceted
 *  active / expired. */
function SuinsView({ network, id, type }: { network: Network; id: string; type: string | null }) {
  const names = useAsync(
    (signal) =>
      type ? fetchOwnedSuinsNames(network, id, type, signal) : Promise.resolve<OwnedSuinsName[]>([]),
    [network, id, type],
  )
  const now = Date.now()
  return (
    <FullSetView
      spec={viewSpec('suins')}
      items={names.data ?? []}
      loading={!type || names.loading}
      error={names.error}
      empty="no suins names held."
      statusOf={(o) => (o.expirationMs != null && o.expirationMs < now ? 'expired' : 'active')}
      facetOrder={['active', 'expired']}
      renderRow={(o, i) => <SuinsRow key={o.address} n={i + 1} name={o} />}
    />
  )
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

function SuinsRow({ n, name: o }: { n: number; name: OwnedSuinsName }) {
  const e = suinsExpiry(o.expirationMs)
  return (
    <MenuRow n={n}>
      <LinkedHash value={o.address} />
      {o.domain && <span className="text-text min-w-0 truncate">{o.domain}</span>}
      <span
        className={cn('ml-auto shrink-0 tabular-nums', e.expired ? 'text-danger' : 'text-muted')}
        title={e.expired ? 'expired' : 'expiration date'}
      >
        {e.expired ? `expired ${e.text}` : e.text}
      </span>
    </MenuRow>
  )
}

/** Every StakedSui receipt held, largest first, each naming its validator;
 *  faceted active / activating / inactive validator. */
function StakedView({ network, id }: { network: Network; id: string }) {
  const staked = useAsync((signal) => fetchOwnedStakedSui(network, id, signal), [network, id])
  // Lean pool → validator lookup, so each stake names the validator it's with
  // (rather than a raw pool id); a pool missing from the active set means the
  // validator left it. And the current epoch, to tell an activating stake.
  const pools = useAsync((signal) => fetchValidatorPools(network, signal), [network])
  const chain = useAsync((signal) => fetchChainStatus(network, signal), [network])
  const currentEpoch = chain.data?.epoch ?? null
  const poolToValidator = pools.data ?? null
  const validatorHref = useValidatorHref()
  return (
    <FullSetView
      spec={viewSpec('staked')}
      items={staked.data ?? []}
      loading={staked.loading}
      error={staked.error}
      empty="no staked SUI held."
      statusOf={(s) => stakeStatus(s, currentEpoch, poolToValidator)}
      facetOrder={['active', 'activating', 'inactive validator']}
      renderRow={(s, i) => {
        const status = stakeStatus(s, currentEpoch, poolToValidator)
        return (
          <MenuRow key={s.address} n={i + 1} wrap>
            <LinkedHash value={s.address} />
            {status !== 'active' && (
              <Badge
                tone={status === 'activating' ? 'muted' : 'danger'}
                className="shrink-0"
                title={
                  status === 'activating'
                    ? `earns from epoch ${s.activationEpoch}`
                    : 'the validator left the active set — this stake no longer earns'
                }
              >
                {status}
              </Badge>
            )}
            <StakeValidator
              validator={(s.poolId && poolToValidator?.get(s.poolId)) || null}
              poolId={s.poolId}
              href={validatorHref}
            />
            {/* Fixed-width, right-aligned epoch and principal columns so the
                numbers line up down the list. */}
            <span
              className="text-muted ml-auto w-[6.5rem] shrink-0 text-right tabular-nums"
              title={
                status === 'activating'
                  ? 'the epoch this stake starts earning in'
                  : 'the epoch this stake started earning in'
              }
            >
              {s.activationEpoch != null ? `epoch ${formatNumber(s.activationEpoch)}` : ''}
            </span>
            <span
              className="text-text min-w-[10.5rem] shrink-0 text-right tabular-nums"
              title="principal staked"
            >
              {formatSui(s.principal)}
            </span>
          </MenuRow>
        )
      }}
    />
  )
}

/** Where a stake stands: on a validator that left the active set (its pool no
 * longer resolves — it has stopped earning), still activating (its activation
 * epoch is ahead of the current one), or active. Reads as `active` until the
 * epoch / pool lookups land. */
function stakeStatus(
  s: OwnedStakedSui,
  currentEpoch: number | null,
  pools: Map<string, ValidatorRef> | null,
): string {
  if (pools && s.poolId && !pools.has(s.poolId)) return 'inactive validator'
  if (currentEpoch != null && s.activationEpoch != null && s.activationEpoch > currentEpoch) {
    return 'activating'
  }
  return 'active'
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
      <span className="text-muted inline-flex min-w-0 items-center gap-1.5" title="staking pool">
        pool <LinkedHash value={poolId} />
      </span>
    )
  }
  return null
}

/** Every allowance this address funds — each AllowanceCap held, joined
 *  in-query to its live allowance — active first; faceted by status. */
function AllowancesView({ network, id }: { network: Network; id: string }) {
  const allowances = useAsync((signal) => fetchOwnedAllowances(network, id, signal), [network, id])
  const rows = allowances.data ?? []
  const metas = useCoinMetas(
    network,
    rows.map((a) => a.allowance?.coinType),
  )
  const now = Date.now()
  return (
    <FullSetView
      spec={viewSpec('allowances')}
      items={rows}
      loading={allowances.loading}
      error={allowances.error}
      empty="no allowances funded here."
      statusOf={(o) => ownedAllowanceStatus(o, now)}
      facetOrder={ALLOWANCE_STATUS_ORDER}
      renderRow={(a, i) => (
        <AllowanceRow
          key={a.capId}
          n={i + 1}
          owned={a}
          now={now}
          meta={a.allowance?.coinType ? metas.get(a.allowance.coinType) : undefined}
        />
      )}
    />
  )
}

/** One funded allowance: its id, name, and spender, then — right-aligned — the
 *  spend against its lifetime cap and a status tag. A revoked one (the cap was
 *  read before the allowance went) shows only the id and a `revoked` tag.
 *
 *  Layout: a single line, never wrapped. Every column but the name has a fixed
 *  width — the status column is sized to its widest tag — so a row's geometry
 *  never depends on its content and the columns line up down the list. The name
 *  is the one column that gives when the pane is narrow: it truncates in place
 *  (the full name stays in its tooltip). */
const ALLOWANCE_STATUS_COL = 'flex w-[6.5rem] shrink-0 justify-end'

function AllowanceRow({
  n,
  owned,
  now,
  meta,
}: {
  n: number
  owned: OwnedAllowance
  now: number
  meta?: CoinMeta
}) {
  const a = owned.allowance
  if (!a) {
    return (
      <MenuRow n={n}>
        <span className="shrink-0 whitespace-nowrap">
          <LinkedHash value={owned.allowanceId} />
        </span>
        <span className={cn('ml-auto', ALLOWANCE_STATUS_COL)}>
          <AllowanceStatusBadge allowance={null} />
        </span>
      </MenuRow>
    )
  }
  // `spent / cap SYMBOL` — the symbol once, on the pair.
  const value =
    a.lifetimeCap != null
      ? `${formatTokenAmount(a.currentSpend, meta?.decimals ?? 0)} / ${formatCoinAmount(a.lifetimeCap, meta)}`
      : formatCoinAmount(a.currentSpend, meta)
  return (
    <MenuRow n={n}>
      <span className="shrink-0 whitespace-nowrap">
        <LinkedHash value={a.id} />
      </span>
      <span className="text-text w-[30ch] min-w-0 shrink truncate" title={a.name || undefined}>
        {a.name ? clampText(a.name, 30) : <span className="text-muted">—</span>}
      </span>
      {a.spender && (
        <span
          className="text-muted inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
          title="spender"
        >
          for <AddressLink value={a.spender} />
        </span>
      )}
      <span
        className="text-text ml-auto min-w-[7.5rem] shrink-0 text-right tabular-nums whitespace-nowrap"
        title={a.lifetimeCap != null ? 'spent / lifetime cap' : 'spent (no lifetime cap)'}
      >
        {value}
      </span>
      <span className={ALLOWANCE_STATUS_COL}>
        <AllowanceStatusBadge allowance={a} now={now} />
      </span>
    </MenuRow>
  )
}

/** Every UpgradeCap held — the packages this address can upgrade — with the
 *  MVR names of those packages; faceted by upgrade policy. */
function UpgradeCapsView({ network, id }: { network: Network; id: string }) {
  const caps = useAsync((signal) => fetchAllOwnedUpgradeCaps(network, id, signal), [network, id])
  const rows = useMemo(() => toCapRows(caps.data ?? []), [caps.data])
  const names = useUpgradeCapPackageNames(network, rows)
  return (
    <FullSetView
      spec={viewSpec('upgradecaps')}
      items={rows}
      loading={caps.loading}
      error={caps.error}
      empty="no upgrade caps held."
      statusOf={capPolicy}
      facetOrder={['compatible', 'additive', 'dependency-only', 'restricted', 'unknown policy']}
      renderRow={(r, i) => (
        <UpgradeCapRow
          key={r.id}
          row={r}
          mvrName={r.package ? names[r.package] : undefined}
          n={i + 1}
        />
      )}
    />
  )
}

function capPolicy(r: CapRow): string {
  return r.policy != null ? policyLabel(r.policy) : 'unknown policy'
}

/** Every MVR app registration held, each name resolved to the package it
 *  points at on mainnet and on testnet; faceted by where it resolves. */
function MvrAppsView({ network, id, type }: { network: Network; id: string; type: string | null }) {
  const apps = useAsync(
    (signal) =>
      type ? fetchOwnedMvrApps(network, id, type, signal) : Promise.resolve<OwnedMvrApp[]>([]),
    [network, id, type],
  )
  const rows = apps.data ?? []
  const packages = useMvrAppPackages(rows)
  return (
    <FullSetView
      spec={viewSpec('mvr')}
      items={rows}
      loading={!type || apps.loading}
      error={apps.error}
      empty="no mvr packages registered here."
      statusOf={(a) =>
        packages.mainnet[a.name] ? 'mainnet' : packages.testnet[a.name] ? 'testnet only' : 'no package'
      }
      facetOrder={['mainnet', 'testnet only', 'no package']}
      renderRow={(a, i) => (
        <MvrAppRow
          key={a.address}
          n={i + 1}
          app={a}
          mainnetPkg={packages.mainnet[a.name] ?? null}
          testnetPkg={packages.testnet[a.name] ?? null}
        />
      )}
    />
  )
}

/** The packages a set of MVR names point at, per registry: one bulk call each
 *  against mainnet and testnet (a name with no mainnet package can still carry
 *  a testnet mapping — the mainnet resolver alone would call it unassigned).
 *  `{ name: packageId }` per network, unresolved names absent. Re-runs only when
 *  the set of names changes. */
function useMvrAppPackages(apps: OwnedMvrApp[]): {
  mainnet: Record<string, string>
  testnet: Record<string, string>
} {
  const key = [...new Set(apps.map((a) => a.name))].sort().join(',')
  const { data } = useAsync(
    async (signal) => {
      if (!key) return NO_PACKAGES
      const names = key.split(',')
      const [mainnet, testnet] = await Promise.all([
        resolveMvrNamesBulk('mainnet', names, signal),
        resolveMvrNamesBulk('testnet', names, signal),
      ])
      return { mainnet, testnet }
    },
    [key],
  )
  return data ?? NO_PACKAGES
}
const NO_PACKAGES = { mainnet: {}, testnet: {} }

/** One MVR app registration: the AppCap id, the app name (linked to its
 *  registry page here, and out to moveregistry.com), then the package the name
 *  points at — the mainnet one, with its testnet mapping alongside when both
 *  exist; a testnet-only mapping labelled as such; or that none is set. (The
 *  cap's `is_immutable` flag isn't shown: it flips exactly when a mainnet
 *  package is assigned, so the package column already says it.) */
function MvrAppRow({
  n,
  app,
  mainnetPkg,
  testnetPkg,
}: {
  n: number
  app: OwnedMvrApp
  mainnetPkg: string | null
  testnetPkg: string | null
}) {
  return (
    <MenuRow n={n} wrap>
      <span className="shrink-0">
        <LinkedHash value={app.address} />
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <EntityLink id={app.name} />
        <a
          href={mvrAppUrl(app.name)}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-primary transition-colors"
          title="open on moveregistry.com"
        >
          <ExternalLink size={12} />
        </a>
      </span>
      {mainnetPkg ? (
        <>
          <span className="text-muted shrink-0" title="points at this package on mainnet">
            →
          </span>
          <LinkedHash value={mainnetPkg} network="mainnet" />
          {testnetPkg && (
            <span className="text-muted inline-flex shrink-0 items-center gap-1.5">
              · testnet <LinkedHash value={testnetPkg} network="testnet" />
            </span>
          )}
        </>
      ) : testnetPkg ? (
        <>
          <span
            className="text-muted shrink-0"
            title="no mainnet package — points at this package on testnet"
          >
            testnet →
          </span>
          <LinkedHash value={testnetPkg} network="testnet" />
        </>
      ) : (
        <span className="text-muted">no package on any network</span>
      )}
    </MenuRow>
  )
}

/* ── shared rows and lookups ─────────────────────────────────────────────── */

/** Collapse whitespace and clamp to `max` chars with an ellipsis — keeps a
 * long display description from dominating its row (full text stays in `title`). */
function clampText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
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
    <MenuRow n={index} top>
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
    </MenuRow>
  )
}

/** A type-filtered row: the object id, then its Display `name` and (clamped)
 *  `description` when it has them — the full text in the tooltip. */
function DisplayRow({
  n,
  address,
  name,
  description,
}: {
  n: number
  address: string
  name: string | null
  description: string | null
}) {
  return (
    <MenuRow n={n}>
      <LinkedHash value={address} />
      {(name || description) && (
        <span
          className="min-w-0 flex-1 truncate"
          title={[name, description].filter(Boolean).join(' — ')}
        >
          {name && <span className="text-text">{name}</span>}
          {name && description && <span className="text-muted"> · </span>}
          {description && <span className="text-muted">{clampText(description, 48)}</span>}
        </span>
      )}
    </MenuRow>
  )
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
 * merge in. That matters for the COINS view, whose object set grows as the
 * background ownership scan pages in: values appear incrementally and never
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
    () => [...new Set(objects.map((o) => coinInnerType(o.type)).filter((t): t is string => !!t))],
    [objects],
  )

  // Fetch only the balances we don't already hold, then merge them in.
  const missingBalanceKey = ids.filter((id) => !balances.has(id)).join(',')
  useEffect(() => {
    if (!missingBalanceKey) return
    const controller = new AbortController()
    fetchCoinObjectBalances(network, missingBalanceKey.split(','), controller.signal)
      .then((m) => {
        if (!controller.signal.aborted && m.size) setBalances((prev) => new Map([...prev, ...m]))
      })
      .catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, missingBalanceKey])

  // Same for metadata, keyed by coin type.
  const missingTypesKey = innerTypes.filter((t) => !meta.has(t)).join(',')
  useEffect(() => {
    if (!missingTypesKey) return
    const controller = new AbortController()
    fetchCoinMetadata(network, missingTypesKey.split(','), controller.signal)
      .then((m) => {
        if (!controller.signal.aborted && m.size) setMeta((prev) => new Map([...prev, ...m]))
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
    return { value: raw == null ? null : formatCoinAmount(raw, m), meta: m }
  }
}

/* ── background full-ownership scan → unique types + scan families ───────── */

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

const EMPTY_SCAN: ScanState = {
  types: [],
  caps: [],
  coins: [],
  displays: [],
  total: 0,
  done: false,
  capped: false,
  error: null,
}

function useOwnedTypeScan(network: Network, id: string): OwnedScan {
  const [state, setState] = useState<ScanState>(EMPTY_SCAN)
  // Flipped once the user opts into a full scan; re-runs the effect uncapped.
  const [unbounded, setUnbounded] = useState(false)

  // A new owner starts capped again.
  useEffect(() => setUnbounded(false), [network, id])

  useEffect(() => {
    const controller = new AbortController()
    setState(EMPTY_SCAN)

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

/* ── left pane: the type breakdown + quick filters ───────────────────────── */

function TypesOwned({
  scan,
  filter,
  onToggle,
}: {
  scan: OwnedScan
  filter: Filter
  onToggle: (next: Filter) => void
}) {
  const { types, caps, coins, displays, total, done, capped, error, loadAll } = scan
  const [filterText, setFilterText] = useState('')
  const q = filterText.trim().toLowerCase()

  // Each named view's count: the scan families by their collected objects, the
  // type-owned views from the scan's breakdown. Only views with something to
  // show get a quick filter.
  const countFor = (v: ViewSpec): number => {
    if (v.kind === 'coins') return coins.length
    if (v.kind === 'displays') return displays.length
    if (v.kind === 'capabilities') return caps.length
    return types.filter((t) => v.match!(t.type)).reduce((sum, t) => sum + t.count, 0)
  }
  const quick = VIEWS.map((v) => ({ spec: v, count: countFor(v) })).filter((x) => x.count > 0)

  // The text filter matches the shortened form the list shows (`0x2::…`) as
  // well as the full repr — both lowered once per scan update, not per keystroke.
  const searchable = useMemo(
    () => types.map((t) => ({ ...t, hay: `${t.type} ${formatType(t.type)}`.toLowerCase() })),
    [types],
  )
  // The quick filters are shortcuts only — their types stay in the full list
  // too, since dropping them empties it for a coin-/cap-/suins-heavy owner.
  const shown = q ? searchable.filter((t) => t.hay.includes(q)) : searchable

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
            {quick.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {quick.map(({ spec, count }) => (
                  <QuickFilter
                    key={spec.kind}
                    icon={spec.icon}
                    label={spec.chip}
                    count={count}
                    active={filter?.kind === spec.kind}
                    onClick={() => onToggle({ kind: spec.kind })}
                    title={spec.title}
                  />
                ))}
              </div>
            )}

            {capped && (
              <div className="border-line bg-surface-2 mb-3 flex flex-wrap items-center justify-between gap-2 border px-2.5 py-2 font-mono text-xs">
                <span className="text-muted">
                  too many objects — types cover the first {formatNumber(total)} only.
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
                  // A type a named view owns is "active" when that view is.
                  const active = filter
                    ? filter.kind === 'type'
                      ? filter.type === t.type
                      : dedicatedViewFor(t.type) === filter.kind
                    : false
                  return (
                    <li key={t.type}>
                      <button
                        type="button"
                        onClick={() => onToggle({ kind: 'type', type: t.type })}
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
              <span className="text-muted text-sm">no types match “{filterText}”.</span>
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

/** A pre-built, full-width filter toggle above the per-type list. Active =
 *  highlighted; the count sits on the right. */
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
