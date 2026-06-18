import { useEffect, useState, type ReactNode } from 'react'
import { AtSign, Coins, Images, KeyRound, Loader2, Stamp, X } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { LinkedHash, TypeLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchOwnedPage,
  fetchOwnedPublishers,
  fetchOwnedUpgradeCaps,
  type OwnedObject,
} from '@/lib/object'
import { resolveMvrType } from '@/lib/mvr'
import { isUpgradeCapType } from '@/lib/upgradeCap'
import { formatType } from '@/lib/format'
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

/** The SuiNS registration type as an MVR *type* name, resolved to a per-network
 * on-chain type via `resolveMvrType` (so no hardcoded per-network package id).
 * Pinned to `/1` because `SuinsRegistration` is defined in SuiNS Core V1 — the
 * unversioned `@suins/core` is a facade package the type filter wouldn't match. */
const SUINS_REGISTRATION_MVR =
  '@suins/core/1::suins_registration::SuinsRegistration'

/** Does a type repr name a SuiNS registration? Matched by `module::struct` so the
 * per-network / upgraded package id still counts. */
function isSuinsType(repr: string | null | undefined): boolean {
  return !!repr && /::suins_registration::SuinsRegistration$/.test(repr)
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
  | null

/** Collapse whitespace and clamp to `max` chars with an ellipsis — keeps a
 * long display description from dominating its row (full text stays in `title`). */
function clampText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

export function OwnedObjects({ id }: { id: string }) {
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
  const typeFilter = filter?.kind === 'type' ? filter.type : null

  // Pager key carries the active view so switching filters resets pagination.
  const pager = useCursorPager(
    `${network}|${id}|${typeFilter ?? filter?.kind ?? ''}`,
  )
  // UpgradeCaps get the richer cap formatting (governed package + policy) used
  // by the "UpgradeCaps held" panel — which needs each object's `contents.json`,
  // a different fetch than the plain owned-objects list.
  const caps = !!typeFilter && isUpgradeCapType(typeFilter)

  const page = useAsync(
    (signal) =>
      typeFilter && !caps
        ? fetchOwnedPage(
            network,
            id,
            { first: pager.pageSize, after: pager.after, type: typeFilter, display: true },
            signal,
          )
        : Promise.resolve(null),
    [network, id, pager.pageSize, pager.after, typeFilter, caps],
  )
  const capPage = useAsync(
    (signal) =>
      caps
        ? fetchOwnedUpgradeCaps(
            network,
            id,
            { first: pager.pageSize, after: pager.after },
            signal,
          )
        : Promise.resolve(null),
    [network, id, pager.pageSize, pager.after, caps],
  )
  // Publishers need `contents.json` (package + module), not Display — its own
  // server fetch, paginated like the cap list.
  const pubPage = useAsync(
    (signal) =>
      showPublishers
        ? fetchOwnedPublishers(
            network,
            id,
            { first: pager.pageSize, after: pager.after },
            signal,
          )
        : Promise.resolve(null),
    [network, id, pager.pageSize, pager.after, showPublishers],
  )

  const capRows = toCapRows(capPage.data?.caps ?? [])
  const capNames = useUpgradeCapPackageNames(network, capRows)

  const active = showPublishers ? pubPage : caps ? capPage : page
  const hasNext = showPublishers
    ? pubPage.data?.hasNextPage
    : caps
      ? capPage.data?.hasNextPage
      : page.data?.hasNextPage
  const endCursor =
    (showPublishers
      ? pubPage.data?.endCursor
      : caps
        ? capPage.data?.endCursor
        : page.data?.endCursor) ?? null

  // Capability rows come straight from the scan (already in memory) — grouped by
  // type so like caps sit together.
  const capabilityRows = showCaps
    ? [...capabilities].sort(
        (a, b) =>
          (a.type ?? '').localeCompare(b.type ?? '') ||
          a.address.localeCompare(b.address),
      )
    : []

  // Coin rows from the scan, sorted by inner coin type so like coins group.
  const coinRows = showCoins
    ? [...coins].sort(
        (a, b) =>
          (coinInnerType(a.type) ?? '').localeCompare(coinInnerType(b.type) ?? '') ||
          a.address.localeCompare(b.address),
      )
    : []

  // Display rows from the scan — newer registry Displays first, then legacy,
  // each group sorted by the displayed type.
  const displayRows = showDisplays
    ? [...displays].sort((a, b) => {
        const da = displayInner(a.type)
        const db = displayInner(b.type)
        return (
          Number(da?.legacy ?? false) - Number(db?.legacy ?? false) ||
          (da?.inner ?? '').localeCompare(db?.inner ?? '') ||
          a.address.localeCompare(b.address)
        )
      })
    : []

  return (
    <Panel className="min-w-0">
      <PanelSection
        label={
          showCaps
            ? 'Capabilities'
            : showCoins
              ? 'Coins'
              : showDisplays
                ? 'Displays'
                : showPublishers
                  ? 'Publishers'
                  : 'Owned objects'
        }
        action={
          typeFilter || showPublishers ? (
            <Pager
              pageIndex={pager.pageIndex}
              pageSize={pager.pageSize}
              onPageSize={pager.setPageSize}
              hasNext={!!hasNext}
              onPrev={pager.prev}
              onNext={() => pager.next(endCursor)}
              label="objects"
            />
          ) : showCaps ? (
            <span className="text-muted font-mono text-xs">
              {capabilityRows.length}
            </span>
          ) : showCoins ? (
            <span className="text-muted font-mono text-xs">{coinRows.length}</span>
          ) : showDisplays ? (
            <span className="text-muted font-mono text-xs">
              {displayRows.length}
            </span>
          ) : undefined
        }
      >
        {!filter ? (
          <EmptyState title="no filter selected">
            pick a quick filter, or select a type from the list, to list the
            objects owned here.
          </EmptyState>
        ) : showCaps ? (
          <>
            <FilterChip
              label="capabilities"
              title="capabilities"
              onClear={onClearFilter}
            />
            {capabilityRows.length > 0 ? (
              <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                {capabilityRows.map((o, i) => (
                  <li
                    key={o.address}
                    className="flex items-start gap-3 py-2.5"
                  >
                    <RowIndex n={i + 1} />
                    <span className="shrink-0">
                      <LinkedHash value={o.address} />
                    </span>
                    {o.type && (
                      <span className="text-muted min-w-0 flex-1 break-all">
                        <TypeLink type={o.type} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted text-sm">no capabilities held.</span>
            )}
          </>
        ) : showCoins ? (
          <>
            <FilterChip label="coins" title="coins" onClear={onClearFilter} />
            {coinRows.length > 0 ? (
              <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                {coinRows.map((o, i) => {
                  const inner = coinInnerType(o.type)
                  return (
                    <li key={o.address} className="flex items-start gap-3 py-2.5">
                      <RowIndex n={i + 1} />
                      <span className="shrink-0">
                        <LinkedHash value={o.address} />
                      </span>
                      {inner && (
                        <span className="text-muted min-w-0 flex-1 break-all">
                          <TypeLink type={inner} />
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <span className="text-muted text-sm">no coins held.</span>
            )}
          </>
        ) : showDisplays ? (
          <>
            <FilterChip label="displays" title="displays" onClear={onClearFilter} />
            {displayRows.length > 0 ? (
              <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                {displayRows.map((o, i) => {
                  const d = displayInner(o.type)
                  return (
                    <li key={o.address} className="flex items-start gap-3 py-2.5">
                      <RowIndex n={i + 1} />
                      <span className="shrink-0">
                        <LinkedHash value={o.address} />
                      </span>
                      {d && (
                        <span className="text-muted flex min-w-0 flex-1 items-center gap-2 break-all">
                          <TypeLink type={d.inner} />
                          {d.legacy && (
                            <Badge tone="muted" className="shrink-0">
                              legacy
                            </Badge>
                          )}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <span className="text-muted text-sm">no displays held.</span>
            )}
          </>
        ) : showPublishers ? (
          <>
            <FilterChip
              label="publishers"
              title="publishers"
              onClear={onClearFilter}
            />
            {active.loading ? (
              <SkeletonLines count={5} />
            ) : active.error ? (
              <span className="text-danger font-mono text-xs">
                {active.error.message}
              </span>
            ) : pubPage.data && pubPage.data.publishers.length > 0 ? (
              <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                {pubPage.data.publishers.map((p, i) => (
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
                ))}
              </ul>
            ) : (
              <span className="text-muted text-sm">no publishers held.</span>
            )}
          </>
        ) : (
          <>
            <FilterChip
              label={formatType(typeFilter!)}
              title={typeFilter!}
              onClear={onClearFilter}
            />

            {active.loading ? (
              <SkeletonLines count={5} />
            ) : active.error ? (
              <span className="text-danger font-mono text-xs">
                {active.error.message}
              </span>
            ) : caps ? (
              capRows.length > 0 ? (
                <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                  {capRows.map((r, i) => (
                    <UpgradeCapRow
                      key={r.id}
                      row={r}
                      mvrName={r.package ? capNames[r.package] : undefined}
                      n={i + 1}
                    />
                  ))}
                </ul>
              ) : (
                <span className="text-muted text-sm">
                  no owned objects of this type.
                </span>
              )
            ) : page.data && page.data.objects.length > 0 ? (
              <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
                {page.data.objects.map((o, i) => (
                  <li key={o.address} className="flex items-center gap-3 py-2.5">
                    <RowIndex n={i + 1} />
                    <LinkedHash value={o.address} />
                    {(o.name || o.description) && (
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={[o.name, o.description]
                          .filter(Boolean)
                          .join(' — ')}
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
                ))}
              </ul>
            ) : (
              <span className="text-muted text-sm">
                no owned objects of this type.
              </span>
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
            { first: 50, after },
            controller.signal,
          )
          for (const o of page.objects) {
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
          <span className="text-danger font-mono text-xs">{error}</span>
        ) : types.length > 0 ? (
          <>
            {/* Pre-built quick filters — one-click shortcuts to common holdings. */}
            {(coins.length > 0 ||
              suinsCount > 0 ||
              publisherCount > 0 ||
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
