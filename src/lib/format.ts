import { formatAddress as sdkFormatAddress } from '@mysten/sui/utils'
import { shortenAddress } from './search'

/**
 * Display form for a single address: leading-zero "named" addresses collapse to
 * their short form (`0x000…0002` → `0x2`, `0xdee9`, …); everything else gets
 * the SDK's middle-truncation (`0x1234…cdef`).
 */
export function formatAddress(addr: string): string {
  return shortenAddress(addr) ?? sdkFormatAddress(addr)
}

const ADDRESS_RE = /0x[0-9a-fA-F]+/g

/**
 * Trim every address inside a Move type repr so long fully-qualified types
 * read cleanly. The SDK has no type formatter, so we apply `formatAddress`
 * to each address (package prefixes and generic args alike).
 *
 *   0x000…0002::coin::Coin<0xabc…111::usdc::USDC>
 *     → 0x2::coin::Coin<0xabc…111::usdc::USDC>
 */
export function formatType(type: string): string {
  return type.replace(ADDRESS_RE, (addr) => formatAddress(addr))
}

// Framework-qualified prefix (0x1/0x2/0x3 std + Sui packages, full 64-hex form):
// `0x000…0002::clock::` — stripped so framework types read as bare names.
export const FRAMEWORK_PREFIX = /0x0{63}[123]::[a-zA-Z0-9_]+::/g

/** Escape a string for literal use inside a `RegExp`. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Format a Move function-signature type for human reading: framework types
 * (`&0x2::clock::Clock`, `&0x2::tx_context::TxContext`) collapse to bare names
 * (`&Clock`, `&TxContext`), custom-package addresses are trimmed, and
 * positional type params (`$0`) become `T0`. Reference markers (`&`, `&mut`)
 * are preserved — they convey how the argument is borrowed.
 *
 *   &mut 0x2c8…809::pool::Pool<$0, $1>  →  &mut 0x2c8d…4809::pool::Pool<T0, T1>
 */
export function formatSignatureType(repr: string): string {
  return formatType(repr.replace(FRAMEWORK_PREFIX, '')).replace(/\$(\d+)/g, 'T$1')
}

/**
 * Render a MIST amount (the on-chain integer unit, 1 SUI = 1e9 MIST) as SUI.
 * Accepts string or number (gas/balance values arrive as `BigInt` strings).
 * Negative values keep their sign; trailing zeros are trimmed.
 */
export function formatSui(mist: string | number | bigint | null | undefined): string {
  if (mist == null) return '—'
  let n: bigint
  try {
    n = BigInt(mist)
  } catch {
    return String(mist)
  }
  const neg = n < 0n
  const abs = neg ? -n : n
  const whole = abs / 1_000_000_000n
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  const sign = neg ? '-' : ''
  return `${sign}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''} SUI`
}

/** Compact count: `942`, `1.2k`, `3.4M`, `1.1B`. For call counts / totals. */
export function formatCount(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return String(n)
  const units = [
    { v: 1_000_000_000, s: 'B' },
    { v: 1_000_000, s: 'M' },
    { v: 1_000, s: 'k' },
  ]
  for (const { v, s } of units) {
    if (abs >= v) {
      const scaled = n / v
      // One decimal under 10 (1.2k), none above (12k) — drop a trailing `.0`.
      const str = (Math.abs(scaled) < 10 ? scaled.toFixed(1) : Math.round(scaled).toString())
        .replace(/\.0$/, '')
      return str + s
    }
  }
  return String(n)
}

/** Format an ISO timestamp as a readable absolute time; `—` when missing. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}
