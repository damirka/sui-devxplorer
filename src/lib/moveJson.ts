/**
 * Scalar coercions for Move values as Sui GraphQL renders them in `json`: u64
 * and wider ints arrive as decimal strings, u8–u32 as numbers, and an absent
 * `Option` as `null`. Every decoder of object contents (staking, validators,
 * allowances, …) wants the same three readings.
 */

/** A u64/u128/u256 field → `bigint`; `null` when absent or unparseable. */
export function bigOrNull(v: unknown): bigint | null {
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v)
    } catch {
      return null
    }
  }
  return null
}

/** Like {@link bigOrNull}, but `0n` when absent/unparseable — for totals. */
export function bigOrZero(v: unknown): bigint {
  return bigOrNull(v) ?? 0n
}

/** A numeric field → `number`, preserving `null`/absent as `null` (so a genuine
 *  `0` — e.g. an epoch-0 activation — isn't confused with "unset"). */
export function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}
