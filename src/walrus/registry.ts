/**
 * The Walrus deployment on each Sui network: the package's original id, the
 * shared objects that hold the protocol's state, the header tags they get,
 * and the search keywords that open them. Walrus isn't in SuiNS or (reliably)
 * in MVR, and its ids differ per network — so this table IS the name
 * resolution. Only what can't be fetched lives here: the package's upgrade
 * chain (later versions, dates) is read from GraphQL, so an upgrade changes
 * nothing in this file — the shared objects keep their ids for life.
 *
 * Source of truth: the `Published.toml` under each package of `mainnet-contracts`
 * and `testnet-contracts` in github.com/MystenLabs/walrus, plus
 * the Available Networks page of docs.wal.app. Cross-checked on-chain
 * 2026-09-13.
 *
 * Keep this file free of imports from `@/lib` — it feeds the search aliases,
 * so the dependency must point one way.
 */
import type { FixedNetwork, Network } from '@/context/network-context'

/** One well-known Walrus id and how it's presented. */
export interface WalrusEntry {
  /** Full 64-hex, `0x`-prefixed id. */
  id: string
  /** The header tag, lowercase (the badge uppercases). */
  tag: string
  /** Tooltip for the tag. */
  title: string
  /** Search aliases that resolve to this id. Lowercase, no spaces. */
  keywords?: string[]
}

export interface WalrusDeployment {
  /** The Walrus package's *original* id — what every Walrus type is tagged
   *  with, and the root of its upgrade chain. */
  packageId: string
  /** The WAL coin package (single version so far); `${walPackageId}::wal::WAL`. */
  walPackageId: string
  /** The `walrus::system::System` shared object. */
  systemId: string
  /** The `walrus::staking::Staking` shared object. */
  stakingId: string
  /** Every well-known id on this network, tagged. */
  entries: WalrusEntry[]
  /** Public aggregator (reads) base URL. */
  aggregatorUrl: string
  /** Rough epoch length, for copy ("2 weeks"); the exact ms comes from chain. */
  epochLength: string
}

const MAINNET_PACKAGE = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77'
const MAINNET_SYSTEM = '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2'
const MAINNET_STAKING = '0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904'
const MAINNET_WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59'

const TESTNET_PACKAGE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66'
const TESTNET_SYSTEM = '0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af'
const TESTNET_STAKING = '0xbe46180321c30aab2f8b3501e24048377287fa708018a5b7c2792b35fe339ee3'
const TESTNET_WAL = '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a'

/** The original package id's row. Later versions get the same plain tag from
 *  the upgrade chain (`useWalrusPackage`); `walrus` (→ the latest version) is
 *  a `latestVersion` alias on this id, see `walrusAliases`. */
function packageEntry(id: string): WalrusEntry {
  return {
    id,
    tag: 'walrus package',
    title:
      "the Walrus package's original id — every Walrus type is tagged with it; later versions are in the chain below",
    keywords: ['walrus-package', 'walrus-pkg', 'walrus-original'],
  }
}

export const WALRUS_DEPLOYMENTS: Partial<Record<FixedNetwork, WalrusDeployment>> = {
  mainnet: {
    packageId: MAINNET_PACKAGE,
    walPackageId: MAINNET_WAL,
    systemId: MAINNET_SYSTEM,
    stakingId: MAINNET_STAKING,
    aggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
    epochLength: '2 weeks',
    entries: [
      {
        id: MAINNET_SYSTEM,
        tag: 'walrus system',
        title: 'the Walrus System object — committee, capacity, prices, and the blob accounting',
        keywords: ['walrus-system'],
      },
      {
        id: MAINNET_STAKING,
        tag: 'walrus staking',
        title: 'the Walrus Staking object — storage-node pools, the epoch clock, and committee selection',
        keywords: ['walrus-staking'],
      },
      {
        id: '0xc42868ad4861f22bd1bcd886ae1858d5c007458f647a49e502d44da8bbd17b51',
        tag: 'walrus upgrade manager',
        title: 'holds the Walrus package UpgradeCap — upgrades pass by a quorum vote of storage nodes',
        keywords: ['walrus-upgrade-manager', 'walrus-upgrades'],
      },
      {
        id: '0xb2ce8bd6e372ea93422a167b52d1ac367d080f67a6c4356334aca8e96ba0577a',
        tag: 'walrus subsidies',
        title: 'the walrus_subsidies object — the storage subsidy pool',
        keywords: ['walrus-subsidies'],
      },
      {
        id: '0xb606eb177899edc2130c93bf65985af7ec959a2755dc126c953755e59324209e',
        tag: 'walrus subsidies · legacy',
        title: 'the original subsidies object (subsidies::Subsidies) — superseded by walrus_subsidies',
      },
      packageEntry(MAINNET_PACKAGE),
      {
        id: MAINNET_WAL,
        tag: 'wal package',
        title: 'the WAL token package — 0x356a…4f59::wal::WAL, 9 decimals (FROST)',
        keywords: ['wal', 'wal-package'],
      },
    ],
  },
  testnet: {
    packageId: TESTNET_PACKAGE,
    walPackageId: TESTNET_WAL,
    systemId: TESTNET_SYSTEM,
    stakingId: TESTNET_STAKING,
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    epochLength: '1 day',
    entries: [
      {
        id: TESTNET_SYSTEM,
        tag: 'walrus system',
        title: 'the Walrus System object — committee, capacity, prices, and the blob accounting',
        keywords: ['walrus-system'],
      },
      {
        id: TESTNET_STAKING,
        tag: 'walrus staking',
        title: 'the Walrus Staking object — storage-node pools, the epoch clock, and committee selection',
        keywords: ['walrus-staking'],
      },
      {
        id: '0xc768e475fd1527b7739884d7c3a3d1bc09ae422dfdba6b9ae94c1f128297283c',
        tag: 'walrus upgrade manager',
        title: 'holds the Walrus package UpgradeCap — upgrades pass by a quorum vote of storage nodes',
        keywords: ['walrus-upgrade-manager', 'walrus-upgrades'],
      },
      {
        id: '0x21432c30c510a27432bda9349d9f3f0aff5b84285c369f67dfd3d3ef4cf4eb35',
        tag: 'walrus subsidies',
        title: 'the walrus_subsidies object — the storage subsidy pool',
        keywords: ['walrus-subsidies'],
      },
      {
        id: '0xda799d85db0429765c8291c594d334349ef5bc09220e79ad397b30106161a0af',
        tag: 'walrus subsidies · legacy',
        title: 'the original subsidies object (subsidies::Subsidies) — superseded by walrus_subsidies',
      },
      packageEntry(TESTNET_PACKAGE),
      {
        id: TESTNET_WAL,
        tag: 'wal package',
        title: 'the testnet WAL token package — ::wal::WAL, 9 decimals (FROST)',
        keywords: ['wal', 'wal-package'],
      },
      // Testnet only: SUI ↔ WAL faucet exchanges (1:1). The first is the one
      // `walrus get-wal` defaults to; all four are in the client config.
      {
        id: '0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073',
        tag: 'wal exchange',
        title: 'a testnet SUI ↔ WAL exchange (1:1) — what `walrus get-wal` uses',
        keywords: ['wal-exchange'],
      },
      {
        id: '0x19825121c52080bb1073662231cfea5c0e4d905fd13e95f21e9a018f2ef41862',
        tag: 'wal exchange',
        title: 'a testnet SUI ↔ WAL exchange (1:1)',
      },
      {
        id: '0x83b454e524c71f30803f4d6c302a86fb6a39e96cdfb873c2d1e93bc1c26a3bc5',
        tag: 'wal exchange',
        title: 'a testnet SUI ↔ WAL exchange (1:1)',
      },
      {
        id: '0x8d63209cf8589ce7aef8f262437163c67577ed09f3e636a9d8e0813843fb8bf1',
        tag: 'wal exchange',
        title: 'a testnet SUI ↔ WAL exchange (1:1)',
      },
    ],
  },
}

/**
 * Deployments that are gone: objects typed by these packages still exist on
 * chain (blobs from the first Walrus testnet, redeployed from scratch in April
 * 2025), but the network behind them is wiped — the data is unreadable and no
 * epoch clock applies. Tagged as retired on their object pages; never listed as
 * live blobs.
 */
export const WALRUS_RETIRED_PACKAGES: { packageId: string; title: string }[] = [
  {
    packageId: '0x795ddbc26b8cfff2551f45e198b87fc19473f2df50f995376b924ac80e56f88b',
    title: 'from the first Walrus testnet, retired when testnet was redeployed in April 2025 — the stored data is gone',
  },
]

/** The Walrus deployment on `network`, or `null` where there is none (devnet,
 *  a custom endpoint). Every other function here is null-safe on top of this. */
export function walrusDeployment(network: Network): WalrusDeployment | null {
  return (WALRUS_DEPLOYMENTS as Partial<Record<Network, WalrusDeployment>>)[network] ?? null
}

/** The tagged entry for a well-known id on `network`, or null. */
export function walrusEntryFor(network: Network, id: string): WalrusEntry | null {
  const d = walrusDeployment(network)
  return d?.entries.find((e) => e.id === id) ?? null
}

/** Structurally `lib/aliases`' `NetworkAlias` — not imported, to keep the
 *  dependency one-way. */
interface WalrusAlias {
  label: string
  targets: Partial<Record<FixedNetwork, string>>
  latestVersion?: boolean
}

/**
 * The search aliases this registry defines — every entry's keywords, per
 * network, plus `walrus` / `walrus-latest`, which open the package's latest
 * version (resolved from the chain by `AliasView`). Spread into
 * `NETWORK_ALIASES`.
 */
export function walrusAliases(): Record<string, WalrusAlias> {
  const out: Record<string, WalrusAlias> = {}
  for (const [network, d] of Object.entries(WALRUS_DEPLOYMENTS) as [FixedNetwork, WalrusDeployment][]) {
    for (const e of d.entries) {
      for (const k of e.keywords ?? []) {
        ;(out[k] ??= { label: e.tag, targets: {} }).targets[network] = e.id
      }
    }
    for (const k of ['walrus', 'walrus-latest']) {
      ;(out[k] ??= { label: 'the walrus package (latest version)', targets: {}, latestVersion: true }).targets[
        network
      ] = d.packageId
    }
  }
  return out
}
