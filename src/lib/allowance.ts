/**
 * Native allowances (`0x2::allowance`): delegated, bounded, revocable spending
 * from a funder's *address balance*. An `Allowance<Balance<C>>` is always a
 * shared object carrying its `settings` (funder, spender, optional app, limits,
 * validity window, name) and a `current_spend` counter; every spend mutates it.
 * The funder holds a soulbound `AllowanceCap` that points back at the allowance
 * — the module's own discoverability handle (funder → allowances), and what the
 * owned-objects "allowances" filter walks. Revoking destroys both.
 */
import { gqlRequest } from './graphql'
import { normalizeSuiId } from './search'
import { formatSpan } from './format'
import { bigOrNull, numOrNull } from './moveJson'
import { drainPages, mapPage } from './pagination'
import type { Network } from '@/context/network-context'

/** The cap's base type — the owned-objects filter (matches every `<Balance<C>>`). */
export const ALLOWANCE_CAP_TYPE = `${normalizeSuiId('2')}::allowance::AllowanceCap`

/** Does a type repr name an `Allowance<…>` (any zero-padded form of 0x2)? */
export function isAllowanceType(repr: string | null | undefined): boolean {
  return !!repr && /^0x0*2::allowance::Allowance</.test(repr)
}

/** Does a type repr name an `AllowanceCap<…>`? */
export function isAllowanceCapType(repr: string | null | undefined): boolean {
  return !!repr && /^0x0*2::allowance::AllowanceCap</.test(repr)
}

/** The coin type `C` of an `Allowance<Balance<C>>` / `AllowanceCap<Balance<C>>`
 *  repr, or null for a non-`Balance` accumulator type (none exist today). */
export function allowanceCoinType(repr: string | null | undefined): string | null {
  const m = /^0x0*2::allowance::Allowance(?:Cap)?<0x0*2::balance::Balance<(.+)>>$/.exec(repr ?? '')
  return m ? m[1] : null
}

/** A `RateLimit::Windowed` — at most `limit` per window, windows rolling forward
 *  from the first charge. `spent` / `index` are as of the last charge (stale by
 *  design once the window rolls), so a live readout must recompute the window
 *  — see {@link rateLimitWindow}. */
export interface AllowanceRateLimit {
  limit: bigint
  spent: bigint
  /** Start of the first window (epoch-ms), stamped by the first charge; null before. */
  anchorMs: number | null
  /** Which window `spent` accumulates in, numbered from the anchor. */
  index: number
  window: RateLimitWindow
}

/** Windows of a fixed length, or of a count of civil (UTC) months. */
export type RateLimitWindow =
  | { kind: 'periodic'; ms: number }
  | { kind: 'months'; months: number }

export interface AllowanceData {
  id: string
  /** The coin type `C` of `Balance<C>`, or null. */
  coinType: string | null
  /** Free-text label set at issuance (≤ 128 bytes, never read on-chain). */
  name: string
  /** Whose address balance a spend debits. */
  funder: string
  /** Who may spend; null only for future keyless app-bound allowances. */
  spender: string | null
  /** The app type (`TypeName`) an app-bound allowance is gated on, or null. */
  app: string | null
  /** Inclusive lifetime cap on `currentSpend`, or null for no cap. */
  lifetimeCap: bigint | null
  currentSpend: bigint
  /** Inclusive activation time (epoch-ms), or null for immediately. */
  startMs: number | null
  /** Exclusive expiration time (epoch-ms), or null for none. */
  expirationMs: number | null
  rateLimit: AllowanceRateLimit | null
}

/** Decode a `RateLimit` from its Move JSON (`@variant`-tagged enum), or null. */
function parseRateLimit(v: unknown): AllowanceRateLimit | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (r['@variant'] !== 'Windowed') return null
  const limit = bigOrNull(r.limit)
  if (limit == null) return null
  const w = (r.window ?? {}) as Record<string, unknown>
  const size = numOrNull(w.pos0)
  if (size == null) return null
  return {
    limit,
    spent: bigOrNull(r.spent) ?? 0n,
    anchorMs: numOrNull(r.anchor_ms),
    index: numOrNull(r.index) ?? 0,
    window:
      w['@variant'] === 'CalendarMonths'
        ? { kind: 'months', months: size }
        : { kind: 'periodic', ms: size },
  }
}

/**
 * Decode an `Allowance<…>` object's Move JSON. `Option`s arrive unwrapped
 * (value or null) and the `app` `TypeName` as `{ name }`. Null when the shape
 * isn't an allowance (a wrong type, or a malformed value).
 */
export function parseAllowance(typeRepr: string, json: unknown): AllowanceData | null {
  if (!isAllowanceType(typeRepr) || !json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const s = (j.settings ?? null) as Record<string, unknown> | null
  if (!s || typeof j.id !== 'string' || typeof s.funder !== 'string') return null
  const app = s.app
  return {
    id: j.id,
    coinType: allowanceCoinType(typeRepr),
    name: typeof s.name === 'string' ? s.name : '',
    funder: s.funder,
    spender: typeof s.spender === 'string' ? s.spender : null,
    app:
      typeof app === 'string'
        ? app
        : app && typeof app === 'object' && typeof (app as { name?: unknown }).name === 'string'
          ? (app as { name: string }).name
          : null,
    lifetimeCap: bigOrNull(s.lifetime_cap),
    currentSpend: bigOrNull(j.current_spend) ?? 0n,
    startMs: numOrNull(s.start_timestamp_ms),
    expirationMs: numOrNull(s.expiration_timestamp_ms),
    rateLimit: parseRateLimit(s.rate_limit),
  }
}

/* ── status ──────────────────────────────────────────────────────────────── */

/** Where a live allowance stands right now, read from its settings against the
 *  clock. `revoked` (the object is gone) is the caller's call. */
export type AllowanceStatus = 'active' | 'not started' | 'expired' | 'exhausted'

export function allowanceStatus(a: AllowanceData, nowMs: number): AllowanceStatus {
  if (a.expirationMs != null && nowMs >= a.expirationMs) return 'expired'
  if (a.lifetimeCap != null && a.currentSpend >= a.lifetimeCap) return 'exhausted'
  if (a.startMs != null && nowMs < a.startMs) return 'not started'
  return 'active'
}

/** Display order of the statuses — list sorting and facet tabs alike: live
 *  ones first, then pending, then spent-out / lapsed, then gone. */
export const ALLOWANCE_STATUS_ORDER = [
  'active',
  'not started',
  'exhausted',
  'expired',
  'revoked',
] as const

function statusRank(status: string): number {
  const i = (ALLOWANCE_STATUS_ORDER as readonly string[]).indexOf(status)
  return i === -1 ? ALLOWANCE_STATUS_ORDER.length : i
}

/* ── the rate-limit window, recomputed against the clock ─────────────────── */

/**
 * A `RateLimit.Windowed` as it stands *now*: the on-chain `spent` / `index` are
 * only refreshed by a charge, so once the window has rolled since the last
 * spend the live figure is zero. `resetsAtMs` is when the current window ends;
 * null while unanchored (windows only start with the first spend). Ports
 * `index_at` / `elapsed_windows` from `sui::allowance`.
 */
export function rateLimitWindow(
  rl: AllowanceRateLimit,
  now: number,
): { spent: bigint; resetsAtMs: number | null } {
  if (rl.anchorMs == null) return { spent: 0n, resetsAtMs: null }
  const index = windowIndex(rl.window, rl.anchorMs, now)
  return {
    spent: index > rl.index ? 0n : rl.spent,
    resetsAtMs: windowStart(rl.window, rl.anchorMs, index + 1),
  }
}

/** Which window `now` falls in, numbered from the anchor (0 = the first). */
function windowIndex(window: RateLimitWindow, anchorMs: number, now: number): number {
  const elapsedMs = Math.max(0, now - anchorMs)
  if (window.kind === 'periodic') return Math.floor(elapsedMs / window.ms)
  // Calendar months: a month only fully elapses once the anniversary day
  // arrives, clamped to shorter months (a Jan 31 anchor renews Feb 28).
  const a = new Date(anchorMs)
  const n = new Date(anchorMs + elapsedMs)
  let elapsed =
    n.getUTCFullYear() * 12 + n.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth())
  const anniversaryDay = Math.min(a.getUTCDate(), daysInMonth(n.getUTCFullYear(), n.getUTCMonth()))
  if (elapsed > 0 && n.getUTCDate() < anniversaryDay) elapsed -= 1
  return Math.floor(elapsed / window.months)
}

/** When window number `k` (0 = the anchor's) begins, in epoch-ms. Calendar
 *  windows renew on the anchor's day-of-month at 00:00 UTC, clamped. */
function windowStart(window: RateLimitWindow, anchorMs: number, k: number): number {
  if (window.kind === 'periodic') return anchorMs + k * window.ms
  const a = new Date(anchorMs)
  const month0 = a.getUTCMonth() + k * window.months
  const year = a.getUTCFullYear() + Math.floor(month0 / 12)
  const month = ((month0 % 12) + 12) % 12
  return Date.UTC(year, month, Math.min(a.getUTCDate(), daysInMonth(year, month)))
}

/** Days in a (0-based) month. */
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** A window's length for copy: `per 1m` / `per 6h` / `per 7d` when whole, else
 *  the finer span; calendar windows by month count. */
export function rateLimitWindowText(window: RateLimitWindow): string {
  if (window.kind === 'months') {
    const m = window.months
    return m === 1 ? 'per calendar month' : m === 12 ? 'per calendar year' : `per ${m} calendar months`
  }
  for (const [unit, size] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ] as const) {
    if (window.ms >= size && window.ms % size === 0) return `per ${window.ms / size}${unit}`
  }
  return `per ${formatSpan(window.ms)}`
}

/* ── the funder's allowances (via the caps it holds) ─────────────────────── */

/** An allowance the owner funds, reached through the `AllowanceCap` it holds. */
export interface OwnedAllowance {
  /** The `AllowanceCap` object (what the address actually owns). */
  capId: string
  /** The allowance the cap points at. */
  allowanceId: string
  /** Its live state — null once revoked (the cap was read before it went). */
  allowance: AllowanceData | null
}

/** A funded allowance's status, `revoked` once its object is gone. */
export function ownedAllowanceStatus(
  o: OwnedAllowance,
  nowMs: number,
): AllowanceStatus | 'revoked' {
  return o.allowance ? allowanceStatus(o.allowance, nowMs) : 'revoked'
}

// One request per page: the caps owned, each one's `allowance` id field
// dereferenced in-query (`extract` → `asAddress` → `asObject`) to the live
// allowance object. That hop is a point lookup, so a 50-cap page costs a single
// "rich" query — versus a second, batched round-trip for `multiGetObjects`.
const OWNED_ALLOWANCES_QUERY = `
query OwnedAllowances($address: SuiAddress!, $type: String!, $first: Int, $after: String) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        contents {
          allowance: extract(path: "allowance") {
            json
            asAddress { asObject { asMoveObject { contents { type { repr } json } } } }
          }
        }
      }
    }
  }
}
`

interface OwnedAllowanceNode {
  address: string
  contents: {
    allowance: {
      json: unknown
      asAddress: {
        asObject: {
          asMoveObject: { contents: { type: { repr: string }; json: unknown } | null } | null
        } | null
      } | null
    } | null
  } | null
}

function toOwnedAllowance(n: OwnedAllowanceNode): OwnedAllowance | null {
  const ref = n.contents?.allowance
  if (!ref || typeof ref.json !== 'string') return null
  const contents = ref.asAddress?.asObject?.asMoveObject?.contents ?? null
  return {
    capId: n.address,
    allowanceId: ref.json,
    allowance: contents ? parseAllowance(contents.type.repr, contents.json) : null,
  }
}

/**
 * Every allowance `ownerId` funds — via the `AllowanceCap`s it holds, each
 * joined to its live allowance — sorted active first, then by soonest expiry,
 * then name. Drains every page (caps per funder are bounded) so the sort is
 * global.
 */
export async function fetchOwnedAllowances(
  network: Network,
  ownerId: string,
  signal?: AbortSignal,
): Promise<OwnedAllowance[]> {
  const rows = await drainPages(async ({ limit, cursor }) => {
    const { data } = await gqlRequest<{
      address: {
        objects: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: OwnedAllowanceNode[]
        }
      } | null
    }>(
      network,
      OWNED_ALLOWANCES_QUERY,
      { address: ownerId, type: ALLOWANCE_CAP_TYPE, first: limit, after: cursor ?? null },
      signal,
    )
    return mapPage(data.address?.objects, toOwnedAllowance)
  })
  const now = Date.now()
  return rows
    .filter((o): o is OwnedAllowance => o != null)
    .sort(
      (a, b) =>
        statusRank(ownedAllowanceStatus(a, now)) - statusRank(ownedAllowanceStatus(b, now)) ||
        (a.allowance?.expirationMs ?? Infinity) - (b.allowance?.expirationMs ?? Infinity) ||
        (a.allowance?.name ?? '').localeCompare(b.allowance?.name ?? '') ||
        a.allowanceId.localeCompare(b.allowanceId),
    )
}
