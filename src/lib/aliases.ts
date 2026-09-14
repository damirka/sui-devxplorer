/**
 * Search keywords for well-known entities whose id differs per network —
 * `usdc`, `walrus-system`, `wal`, … The keyword is the search value (so a
 * bookmark follows the network switch) and `AliasView` resolves it against
 * the active network: a Move type path opens the type's package page, an
 * object id the object. Keep `lib/search` unaware of what the words are — it
 * only asks `networkAlias()` whether an input is one.
 */
import type { FixedNetwork } from '@/context/network-context'
// walrus: the Walrus registry contributes its keywords (see src/walrus).
import { walrusAliases } from '@/walrus/registry'

export interface NetworkAlias {
  /** What the keyword opens, for the empty state (`usdc isn't on devnet`). */
  label: string
  /** Per network: a Move type path or an object id. */
  targets: Partial<Record<FixedNetwork, string>>
  /** The target is a package's *original* id; open its latest version. */
  latestVersion?: boolean
}

export const NETWORK_ALIASES: Record<string, NetworkAlias> = {
  usdc: {
    label: 'native USDC (Circle)',
    targets: {
      mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    },
  },
  ...walrusAliases(),
}

/** The canonical keyword when `input` is an alias (case- and
 *  separator-insensitive: `Walrus System`, `walrus_system` → `walrus-system`),
 *  else null. */
export function networkAlias(input: string): string | null {
  const k = input.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return Object.hasOwn(NETWORK_ALIASES, k) ? k : null
}
