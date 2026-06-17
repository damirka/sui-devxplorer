/**
 * `0x2::package::UpgradeCap` helpers — the capability object that authorizes
 * upgrades of a package. Pure parsing/formatting, shared by the object view's
 * decoded panel and the owner's "UpgradeCaps held" list.
 */
import { normalizeSuiId } from './search'

/** The cap's Move type. The short form is what the GraphQL type filter wants
 * (it resolves to the defining id, `0x2`). */
export const UPGRADE_CAP_TYPE = '0x2::package::UpgradeCap'

/** The canonical `0x2` framework id, padded — system reprs use the full form. */
const FRAMEWORK_ID = normalizeSuiId('2')

export interface UpgradeCapData {
  /** The package id this cap authorizes upgrades of (its original/defining id). */
  package: string | null
  /** The on-chain version the package is currently at. */
  version: string | null
  /** The upgrade-policy byte (0 / 128 / 192). */
  policy: number | null
}

/**
 * Whether a Move type repr is `0x2::package::UpgradeCap`. The address is
 * normalized first, so it matches whether the repr writes it short (`0x2`) or
 * fully padded (`0x000…0002`, the form GraphQL returns for framework types).
 */
export function isUpgradeCapType(repr: string | null): boolean {
  if (!repr) return false
  const parts = repr.split('::')
  if (parts.length !== 3) return false
  const [addr, mod, name] = parts
  if (mod !== 'package' || name !== 'UpgradeCap') return false
  return normalizeSuiId(addr.replace(/^0x/i, '').toLowerCase()) === FRAMEWORK_ID
}

/**
 * If `(repr, json)` describe an `0x2::package::UpgradeCap`, pull its
 * package / version / policy fields out of the contents JSON; otherwise `null`.
 * (`version` is a u64 serialized as a string; `policy` is a u8 number.)
 */
export function upgradeCapData(
  repr: string | null,
  json: unknown,
): UpgradeCapData | null {
  if (!isUpgradeCapType(repr)) return null
  const f = (json ?? {}) as Record<string, unknown>
  const pkg = typeof f.package === 'string' ? f.package : null
  const version =
    typeof f.version === 'string'
      ? f.version
      : typeof f.version === 'number'
        ? String(f.version)
        : null
  const policy =
    typeof f.policy === 'number'
      ? f.policy
      : typeof f.policy === 'string' && f.policy.trim() !== ''
        ? Number(f.policy)
        : null
  return { package: pkg, version, policy }
}

/** Sui's upgrade-policy bytes (`0x2::package`): how permissive future upgrades
 * may be. Higher = more restrictive; `255` is set when made immutable. */
export function policyLabel(policy: number): string {
  switch (policy) {
    case 0:
      return 'compatible'
    case 128:
      return 'additive'
    case 192:
      return 'dependency-only'
    default:
      return 'restricted'
  }
}
