/**
 * Walrus object types and their Move-JSON decoders. Every Walrus type is tagged
 * with the package's *original* id (`0xfdc8…ea77::blob::Blob` on mainnet even
 * though v3 is live), so matching is strict per network — a `blob::Blob` from
 * some other package is not a Walrus blob.
 */
import type { Network } from '@/context/network-context'
import { bigOrNull, numOrNull } from '@/lib/moveJson'
import { WALRUS_DEPLOYMENTS, WALRUS_RETIRED_PACKAGES, walrusDeployment } from './registry'

/** The struct kinds this module recognises, with the header tag each gets. */
export type WalrusTypeKind = 'blob' | 'storage' | 'stakedWal' | 'nodeCap'

const TYPE_SUFFIX: Record<WalrusTypeKind, string> = {
  blob: '::blob::Blob',
  storage: '::storage_resource::Storage',
  stakedWal: '::staked_wal::StakedWal',
  nodeCap: '::storage_node::StorageNodeCap',
}

export const WALRUS_TYPE_TAG: Record<WalrusTypeKind, { tag: string; title: string }> = {
  blob: { tag: 'walrus blob', title: 'a Walrus blob object — the on-chain handle for stored data' },
  storage: {
    tag: 'walrus storage',
    title: 'a Walrus storage resource — reserved capacity for a span of Walrus epochs',
  },
  stakedWal: { tag: 'staked wal', title: 'WAL staked with a Walrus storage node' },
  nodeCap: { tag: 'walrus node cap', title: "a Walrus storage node's capability object" },
}

/** The full type of a Walrus struct on `network`, or null without a deployment. */
export function walrusType(network: Network, kind: WalrusTypeKind): string | null {
  const d = walrusDeployment(network)
  return d ? d.packageId + TYPE_SUFFIX[kind] : null
}

const PACKAGE_IDS: readonly string[] = Object.values(WALRUS_DEPLOYMENTS).map((d) => d.packageId)

/** The kind of `repr` when it's `<one of packageIds>::<a known struct>`. */
function kindOf(repr: string, packageIds: readonly string[]): WalrusTypeKind | null {
  const pkg = packageIds.find((id) => repr.startsWith(id))
  if (!pkg) return null
  const suffix = repr.slice(pkg.length)
  return (Object.keys(TYPE_SUFFIX) as WalrusTypeKind[]).find((k) => TYPE_SUFFIX[k] === suffix) ?? null
}

/** Which Walrus struct a type repr is — or null. Matched against every live
 *  deployment's package id (they're distinct per network), so callers that
 *  don't hold a network — the owned-objects type registry — can use it too.
 *  A retired deployment's types don't match: see {@link walrusRetiredType}. */
export function walrusTypeKind(repr: string | null | undefined): WalrusTypeKind | null {
  return repr ? kindOf(repr, PACKAGE_IDS) : null
}

/** A Walrus struct from a *retired* deployment (its network wiped): the kind
 *  and why it's dead — or null. */
export function walrusRetiredType(
  repr: string | null | undefined,
): { kind: WalrusTypeKind; title: string } | null {
  if (!repr) return null
  const pkg = WALRUS_RETIRED_PACKAGES.find((r) => repr.startsWith(r.packageId))
  const kind = pkg ? kindOf(repr, [pkg.packageId]) : null
  return pkg && kind ? { kind, title: pkg.title } : null
}

/** Is the repr a Walrus `blob::Blob`? (The owned-objects filter hook.) */
export function isWalrusBlobType(repr: string | null | undefined): boolean {
  return walrusTypeKind(repr) === 'blob'
}

/* ── decoders ─────────────────────────────────────────────────────────────── */

/** A `storage_resource::Storage` — inclusive `startEpoch`, exclusive `endEpoch`. */
export interface WalrusStorage {
  id: string | null
  startEpoch: number
  endEpoch: number
  /** Encoded bytes reserved. */
  storageSize: bigint
}

/** A `blob::Blob` as it sits on chain. Epochs are *Walrus* epochs. */
export interface WalrusBlob {
  id: string
  /** The blob id in Walrus's own notation — base64url of the 32 LE bytes. */
  blobId: string
  /** Unencoded size in bytes. */
  size: bigint
  /** 1 = RS2 (RedStuff over Reed-Solomon), the only live encoding. */
  encodingType: number
  registeredEpoch: number
  /** Null until a storage-node quorum certifies availability. */
  certifiedEpoch: number | null
  deletable: boolean
  storage: WalrusStorage
}

/** Decode a `Storage` from its Move JSON (standalone or embedded in a blob). */
export function parseWalrusStorage(json: unknown): WalrusStorage | null {
  const j = (json ?? {}) as Record<string, unknown>
  const startEpoch = numOrNull(j.start_epoch)
  const endEpoch = numOrNull(j.end_epoch)
  if (startEpoch == null || endEpoch == null) return null
  return {
    id: typeof j.id === 'string' ? j.id : null,
    startEpoch,
    endEpoch,
    storageSize: bigOrNull(j.storage_size) ?? 0n,
  }
}

/** Decode a `Blob` from its Move JSON, or null when the shape doesn't fit. */
export function parseWalrusBlob(id: string, json: unknown): WalrusBlob | null {
  const j = (json ?? {}) as Record<string, unknown>
  const raw = bigOrNull(j.blob_id)
  const storage = parseWalrusStorage(j.storage)
  const registeredEpoch = numOrNull(j.registered_epoch)
  if (raw == null || !storage || registeredEpoch == null) return null
  return {
    id,
    blobId: encodeBlobId(raw),
    size: bigOrNull(j.size) ?? 0n,
    encodingType: numOrNull(j.encoding_type) ?? 0,
    registeredEpoch,
    certifiedEpoch: numOrNull(j.certified_epoch),
    deletable: j.deletable === true,
    storage,
  }
}

/**
 * The on-chain `blob_id: u256` in the notation the Walrus CLI, aggregators and
 * explorers use: the 32 bytes little-endian, base64url, no padding. Verified
 * against a public aggregator (the big-endian reading 404s).
 */
export function encodeBlobId(raw: bigint): string {
  const bytes = new Uint8Array(32)
  let n = raw
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(n & 0xffn)
    n >>= 8n
  }
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The read URL for a blob at the network's public aggregator, or null. */
export function walrusBlobUrl(network: Network, blobId: string): string | null {
  const d = walrusDeployment(network)
  return d ? `${d.aggregatorUrl}/v1/blobs/${blobId}` : null
}

/** Human name for an `encoding_type`. */
export function walrusEncodingName(t: number): string {
  return t === 1 ? 'RS2' : `encoding ${t}`
}
