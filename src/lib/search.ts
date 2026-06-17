/**
 * Search input classification.
 *
 * DevXplorer is search-first: a user pastes any Sui identifier and we decide
 * which view to render. This module is pure and unit-testable — no network,
 * no React. Real disambiguation (e.g. address vs. object id, which share a
 * shape) happens later against GraphQL; for now we make the best static guess.
 */

export type SearchKind =
  | 'address'
  | 'object'
  | 'transaction'
  | 'package'
  | 'suins'
  | 'unknown'

export interface SearchResultKind {
  /** Best-guess entity type for routing. */
  kind: SearchKind
  /** Normalized value (trimmed, lowercased hex, 0x-prefixed where relevant). */
  value: string
  /** Original raw input. */
  raw: string
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
const HEX_RE = /^[0-9a-f]+$/

/** A 32-byte Sui id: `0x` + 64 hex (we also accept short ids that pad to 64). */
function isSuiId(hex: string): boolean {
  return HEX_RE.test(hex) && hex.length > 0 && hex.length <= 64
}

/** Left-pad a hex id to the canonical 64 nibbles. */
export function normalizeSuiId(hex: string): string {
  return '0x' + hex.padStart(64, '0')
}

/**
 * Canonical short form for a leading-zero-padded address: `0x000…0002` → `0x2`,
 * all-zeros → `0x0`. Returns null when the value isn't a `0x`-hex address, or
 * when its significant part is too long to be a "named"/vanity short address —
 * a real 32-byte id has no leading zeros, so middle-truncation reads better.
 */
export function shortenAddress(value: string): string | null {
  const m = /^0x([0-9a-f]+)$/i.exec(value)
  if (!m) return null
  const stripped = m[1].replace(/^0+/, '')
  if (stripped.length > 4) return null
  return '0x' + (stripped || '0')
}

/** Truncate a long id for display: `0x1234…cdef`. Short named addresses
 * (`0x000…0002`) collapse to `0x2` instead. */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  const short = shortenAddress(value)
  if (short) return short
  if (value.length <= lead + tail + 1) return value
  return `${value.slice(0, lead)}…${value.slice(-tail)}`
}

export function detectSearchKind(input: string): SearchResultKind {
  const raw = input
  const trimmed = input.trim()

  if (!trimmed) return { kind: 'unknown', value: '', raw }

  // SuiNS name: `@handle` or `handle.sui`. Resolved to an address at view time.
  if (trimmed.startsWith('@') || /\.sui$/i.test(trimmed)) {
    return { kind: 'suins', value: trimmed, raw }
  }

  // Fully-qualified type / module path → package, e.g. 0x2::coin::Coin
  if (trimmed.includes('::')) {
    const [addr] = trimmed.split('::')
    const hex = addr.replace(/^0x/i, '').toLowerCase()
    if (isSuiId(hex)) {
      return { kind: 'package', value: trimmed, raw }
    }
    return { kind: 'unknown', value: trimmed, raw }
  }

  // 0x-prefixed hex → an object id. On Sui a package is just an immutable
  // object too (it resolves via `asMovePackage`), so every bare id — including
  // the framework ids 0x1/0x2/0x3 — goes through the object view, which adapts.
  if (/^0x/i.test(trimmed)) {
    const hex = trimmed.slice(2).toLowerCase()
    if (isSuiId(hex)) {
      return { kind: 'object', value: normalizeSuiId(hex), raw }
    }
    return { kind: 'unknown', value: trimmed, raw }
  }

  // Bare 64-hex (no prefix) → treat as an id too
  if (HEX_RE.test(trimmed.toLowerCase()) && trimmed.length === 64) {
    return { kind: 'object', value: normalizeSuiId(trimmed.toLowerCase()), raw }
  }

  // Base58, ~43-44 chars → transaction digest
  if (BASE58_RE.test(trimmed) && trimmed.length >= 32 && trimmed.length <= 48) {
    return { kind: 'transaction', value: trimmed, raw }
  }

  return { kind: 'unknown', value: trimmed, raw }
}

