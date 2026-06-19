/**
 * Gas-summary helpers, shared by the transaction views and the object version
 * history (both surface per-transaction gas). Kept in their own module so
 * `object.ts` can use them without importing from `transaction.ts` — which
 * already imports from `object.ts`, so the reverse edge would be circular.
 */

/** A transaction's gas cost breakdown (MIST), from `effects.gasEffects.gasSummary`. */
export interface GasSummary {
  computationCost: string | null
  storageCost: string | null
  storageRebate: string | null
  nonRefundableStorageFee: string | null
}

/** Net gas used = computation + storage − rebate (in MIST). `null` if unknown.
 *  Can be negative when the storage rebate outweighs the spend (e.g. a tx that
 *  deletes objects and reclaims their storage). */
export function netGasUsed(summary: GasSummary | null | undefined): bigint | null {
  if (!summary) return null
  const c = summary.computationCost
  const s = summary.storageCost
  const r = summary.storageRebate
  if (c == null || s == null || r == null) return null
  try {
    return BigInt(c) + BigInt(s) - BigInt(r)
  } catch {
    return null
  }
}
