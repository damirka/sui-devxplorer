import { useEffect, useState } from 'react'
import { KeyRound, Loader2, X } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkedHash, TypeLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchOwnedPage, fetchOwnedUpgradeCaps, type OwnedObject } from '@/lib/object'
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

/** The active right-pane filter: one concrete type, or the synthetic
 * "capabilities" view that spans every `*Cap` type owned. */
type Filter = { kind: 'type'; type: string } | { kind: 'capabilities' } | null

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

  // Clear the filter when the owner or network changes.
  useEffect(() => setFilter(null), [id, network])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <TypesOwned
        scan={scan}
        filter={filter}
        onSelectType={(t) =>
          setFilter((f) =>
            f?.kind === 'type' && f.type === t ? null : { kind: 'type', type: t },
          )
        }
        onSelectCapabilities={() =>
          setFilter((f) => (f?.kind === 'capabilities' ? null : { kind: 'capabilities' }))
        }
      />
      <OwnedList
        network={network}
        id={id}
        filter={filter}
        capabilities={scan.caps}
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

function OwnedList({
  network,
  id,
  filter,
  capabilities,
  onClearFilter,
}: {
  network: Network
  id: string
  filter: Filter
  /** Capability objects gathered by the scan (for the CAPABILITIES view). */
  capabilities: OwnedObject[]
  onClearFilter: () => void
}) {
  const showCaps = filter?.kind === 'capabilities'
  const typeFilter = filter?.kind === 'type' ? filter.type : null

  const pager = useCursorPager(`${network}|${id}|${typeFilter ?? ''}`)
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

  const capRows = toCapRows(capPage.data?.caps ?? [])
  const capNames = useUpgradeCapPackageNames(network, capRows)

  const active = caps ? capPage : page
  const hasNext = caps ? capPage.data?.hasNextPage : page.data?.hasNextPage
  const endCursor =
    (caps ? capPage.data?.endCursor : page.data?.endCursor) ?? null

  // Capability rows come straight from the scan (already in memory) — grouped by
  // type so like caps sit together.
  const capabilityRows = showCaps
    ? [...capabilities].sort(
        (a, b) =>
          (a.type ?? '').localeCompare(b.type ?? '') ||
          a.address.localeCompare(b.address),
      )
    : []

  return (
    <Panel>
      <PanelSection
        label={showCaps ? 'Capabilities' : 'Owned objects'}
        action={
          typeFilter ? (
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
          ) : undefined
        }
      >
        {!filter ? (
          <EmptyState title="no filter selected">
            pick CAPABILITIES, or select a type from the list, to list the objects
            owned here.
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
                    className="flex items-center gap-3 py-2.5"
                  >
                    <RowIndex n={i + 1} />
                    <LinkedHash value={o.address} />
                    {o.type && (
                      <span className="text-muted min-w-0 truncate">
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
    setState({ types: [], caps: [], total: 0, done: false, capped: false, error: null })

    const counts = new Map<string, number>()
    const caps: OwnedObject[] = []
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
  onSelectType,
  onSelectCapabilities,
}: {
  scan: OwnedScan
  filter: Filter
  onSelectType: (type: string) => void
  onSelectCapabilities: () => void
}) {
  const { types, caps, total, done, capped, error, loadAll } = scan
  const [filterText, setFilterText] = useState('')
  const q = filterText.trim().toLowerCase()
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
            {/* Quick filter: every capability the owner holds, in one view. */}
            {caps.length > 0 && (
              <button
                type="button"
                onClick={onSelectCapabilities}
                aria-pressed={filter?.kind === 'capabilities'}
                className={cn(
                  'mb-3 flex w-full items-center justify-between gap-2 border px-3 py-2 font-mono text-xs tracking-wide uppercase transition-colors',
                  filter?.kind === 'capabilities'
                    ? 'border-primary bg-surface-2 text-primary'
                    : 'border-line text-text hover:border-primary hover:text-primary',
                )}
                title="all *Cap capability objects owned here"
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={13} />
                  capabilities
                </span>
                <span className="text-muted">{caps.length}</span>
              </button>
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
