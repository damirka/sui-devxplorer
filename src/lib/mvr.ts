/**
 * Move Registry (MVR) client. MVR assigns human-readable names
 * (`@namespace/app`) to Move packages and tracks every published version of a
 * named package. It is a REST service, separate from Sui GraphQL, and lives on
 * mainnet + testnet only — there is no devnet registry.
 *
 * Three primitives:
 * - reverse: package id  → `@name`        (the name *assigned* to a package)
 * - forward: `@name[/v]` → package id      (resolve a name to an address)
 * - metadata: `@name`    → description / links / latest version
 *
 * The reverse map covers *every* version of a package — any upgrade in the
 * chain resolves back to the same base name.
 */
import type { Network } from '@/context/network-context'

/** MVR is deployed on mainnet and testnet only. */
const ENDPOINTS: Partial<Record<Network, string>> = {
  mainnet: 'https://mainnet.mvr.mystenlabs.com',
  testnet: 'https://testnet.mvr.mystenlabs.com',
}

/** Whether the registry exists for this network (false for devnet). */
export function mvrSupported(network: Network): boolean {
  return network in ENDPOINTS
}

/** A well-formed base name: `@namespace/app` (no trailing version segment). */
const NAME_RE = /^@[a-z0-9-]+\/[a-z0-9._-]+$/i

/** Drop a trailing `/version` segment: `@ns/app/3` → `@ns/app`. */
export function mvrBaseName(name: string): string {
  return name.replace(/\/\d+$/, '')
}

/** Public Move Registry web page for a name (the `moveregistry.com` preview). */
export function mvrAppUrl(name: string): string {
  return `https://www.moveregistry.com/package/${mvrBaseName(name)}`
}

/** Bulk resolution endpoints cap each request at 50 names (like GraphQL). */
const BULK_LIMIT = 50

async function mvrPost<T>(
  network: Network,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T | null> {
  const base = ENDPOINTS[network]
  if (!base) return null
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

/** Build a names path with each segment encoded but `/` kept as a separator,
 * so a name can never escape the `/v1/names/` route. */
function namesPath(name: string): string {
  return '/v1/names/' + name.split('/').map(encodeURIComponent).join('/')
}

/* ── reverse: assign a name to a package ─────────────────────────────── */

/**
 * The MVR name assigned to a package id, or `null` if none. Works for any
 * version in the package's upgrade chain.
 */
export async function reverseResolveMvr(
  network: Network,
  packageId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = await mvrPost<{
    resolution: Record<string, { name: string } | null>
  }>(network, '/v1/reverse-resolution/bulk', { package_ids: [packageId] }, signal)
  return data?.resolution?.[packageId]?.name ?? null
}

/**
 * Reverse-resolve many package ids at once → a `{ id: name }` map (only ids
 * that have a name appear). Chunked to the 50-id request cap. Same caveat as
 * the single form: only ids with a registered reverse mapping resolve.
 */
export async function reverseResolveMvrBulk(
  network: Network,
  packageIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (!mvrSupported(network) || packageIds.length === 0) return {}

  const out: Record<string, string> = {}
  for (let start = 0; start < packageIds.length; start += BULK_LIMIT) {
    const chunk = packageIds.slice(start, start + BULK_LIMIT)
    const data = await mvrPost<{
      resolution: Record<string, { name: string } | null>
    }>(network, '/v1/reverse-resolution/bulk', { package_ids: chunk }, signal)
    for (const id of chunk) {
      const name = data?.resolution?.[id]?.name
      if (name) out[id] = name
    }
  }
  return out
}

/**
 * The name assigned to a package: `knownName` if we arrived via a name search
 * (free), otherwise the reverse-resolution endpoint. Reverse only succeeds for
 * packages whose owner set an on-chain *default name* — a package without one
 * (e.g. `@potatoes/date`) simply resolves to `null`.
 */
export async function mvrNameForPackage(
  network: Network,
  packageId: string,
  knownName?: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!mvrSupported(network)) return null
  if (knownName) return mvrBaseName(knownName)
  return reverseResolveMvr(network, packageId, signal)
}

/* ── forward: resolve a name to a package ────────────────────────────── */

/**
 * Resolve a name (`@ns/app` or a versioned `@ns/app/3`) to its package id, or
 * `null` if it doesn't resolve. The base name points at the latest version.
 */
export async function resolveMvrName(
  network: Network,
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = await mvrPost<{
    resolution: Record<string, { package_id: string } | null>
  }>(network, '/v1/resolution/bulk', { names: [name] }, signal)
  return data?.resolution?.[name]?.package_id ?? null
}

/* ── metadata ────────────────────────────────────────────────────────── */

export interface MvrMetadata {
  iconUrl?: string
  description?: string
  homepageUrl?: string
  documentationUrl?: string
}

/** Source provenance for a single version (where its bytecode was built from). */
export interface MvrGitInfo {
  repositoryUrl: string
  path: string
  tag: string
}

export interface MvrName {
  name: string
  /** Latest registered version number; versions are sequential `1..version`. */
  version: number
  /** The package id the (unversioned) name currently points at. */
  packageAddress: string
  metadata: MvrMetadata
  /** Git provenance of the latest version, when published with source info. */
  gitInfo: MvrGitInfo | null
}

interface RawName {
  name: string
  version: number
  package_address: string
  metadata?: {
    icon_url?: string
    description?: string
    homepage_url?: string
    documentation_url?: string
  }
  git_info?: {
    repository_url?: string
    path?: string
    tag?: string
  } | null
}

/** Fetch a name's registry record (latest version + metadata), or `null`. */
export async function fetchMvrName(
  network: Network,
  name: string,
  signal?: AbortSignal,
): Promise<MvrName | null> {
  const base = ENDPOINTS[network]
  if (!base || !NAME_RE.test(name)) return null
  const res = await fetch(base + namesPath(name), { signal })
  if (!res.ok) return null
  const raw = (await res.json()) as RawName
  const m = raw.metadata ?? {}
  const g = raw.git_info
  return {
    name: raw.name,
    version: raw.version,
    packageAddress: raw.package_address,
    metadata: {
      iconUrl: m.icon_url,
      description: m.description,
      homepageUrl: m.homepage_url,
      documentationUrl: m.documentation_url,
    },
    gitInfo:
      g && g.repository_url
        ? { repositoryUrl: g.repository_url, path: g.path ?? '', tag: g.tag ?? '' }
        : null,
  }
}

/* ── versions ────────────────────────────────────────────────────────── */

export interface MvrVersion {
  version: number
  packageId: string
}

/**
 * Resolve every version `1..latest` of a name to its package id, via the bulk
 * forward-resolution endpoint (chunked to the 50-name request cap). Versions
 * that don't resolve are skipped; the result is ordered by version ascending.
 */
export async function fetchMvrVersions(
  network: Network,
  name: string,
  latest: number,
  signal?: AbortSignal,
): Promise<MvrVersion[]> {
  if (!mvrSupported(network) || latest < 1) return []

  const out: MvrVersion[] = []
  for (let start = 1; start <= latest; start += BULK_LIMIT) {
    const end = Math.min(start + BULK_LIMIT - 1, latest)
    const names: string[] = []
    for (let v = start; v <= end; v++) names.push(`${name}/${v}`)

    const data = await mvrPost<{
      resolution: Record<string, { package_id: string } | null>
    }>(network, '/v1/resolution/bulk', { names }, signal)
    const resolution = data?.resolution ?? {}

    for (let v = start; v <= end; v++) {
      const pid = resolution[`${name}/${v}`]?.package_id
      if (pid) out.push({ version: v, packageId: pid })
    }
  }
  return out
}

/* ── dependents (packages that depend on this one) ───────────────────── */

export interface MvrDependent {
  packageId: string
  /** Aggregated calls to this package from the dependent (0 when uncounted). */
  totalCalls: number
}

export interface MvrDependentsPage {
  dependents: MvrDependent[]
  /** Opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null
  /** Total dependent count (daily-cached, may drift slightly). */
  total: number | null
}

const EMPTY_DEPENDENTS: MvrDependentsPage = {
  dependents: [],
  nextCursor: null,
  total: null,
}

/**
 * One page of the packages that depend on `packageId`, ordered by call volume
 * (descending). Cursor-paginated: pass the previous page's `nextCursor` as
 * `cursor`. `limit` is capped at 50 by the API.
 */
export async function fetchMvrDependents(
  network: Network,
  packageId: string,
  opts: { cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<MvrDependentsPage> {
  const base = ENDPOINTS[network]
  if (!base) return EMPTY_DEPENDENTS

  const params = new URLSearchParams({ limit: String(opts.limit ?? 20) })
  if (opts.cursor) params.set('cursor', opts.cursor)

  const res = await fetch(
    `${base}/v1/package-address/${packageId}/dependents?${params}`,
    { signal },
  )
  if (!res.ok) return EMPTY_DEPENDENTS

  const json = (await res.json()) as {
    data?: { package_id: string; aggregated_total_calls?: number }[]
    next_cursor?: string | null
    total?: number | null
  }
  return {
    dependents: (json.data ?? []).map((d) => ({
      packageId: d.package_id,
      totalCalls: d.aggregated_total_calls ?? 0,
    })),
    nextCursor: json.next_cursor ?? null,
    total: json.total ?? null,
  }
}

/* ── combined: everything for a package's MVR panel ──────────────────── */

export interface MvrPackageInfo {
  /** The base name assigned to this package. */
  name: string
  record: MvrName
  versions: MvrVersion[]
}

/**
 * Resolve a package's MVR identity: its registry record and full version list.
 *
 * When `knownName` is given (we arrived via a name search), it's used directly
 * — important because reverse resolution only works for packages whose owner
 * registered a reverse mapping, which many named packages never do (their
 * forward name + metadata still exist). Otherwise we reverse-resolve the id,
 * which is best-effort. Returns `null` when there's no registry, no name, or
 * no record — so a caller can render only for named packages.
 */
export async function fetchMvrForPackage(
  network: Network,
  packageId: string,
  knownName: string | null,
  signal?: AbortSignal,
): Promise<MvrPackageInfo | null> {
  if (!mvrSupported(network)) return null

  const name = await mvrNameForPackage(network, packageId, knownName, signal)
  if (!name) return null

  const record = await fetchMvrName(network, name, signal)
  if (!record) return null

  const versions = await fetchMvrVersions(network, name, record.version, signal)
  return { name, record, versions }
}
