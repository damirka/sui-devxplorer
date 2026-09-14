/**
 * Walrus — decentralized blob storage on Sui — as a self-contained module.
 * Everything Walrus-specific lives in this directory; the rest of the app
 * touches it at three seams, each marked `// walrus:` at the host:
 *
 *   lib/aliases.ts               `walrusAliases`  → the search keywords (`walrus-system`, `wal`, …)
 *   pages/results/ObjectView     `WalrusTags` + `WalrusNote` in the header
 *   pages/results/OwnedObjects   the "walrus blobs" view (predicate, data, row)
 *
 * This barrel is what the owned-objects view imports. The other two seams
 * import their file directly: `aliases.ts` takes `registry.ts` so the search
 * classifier stays a leaf, and `ObjectView` takes the two components so the
 * barrel needn't be in its import graph.
 *
 * `registry.ts` holds the per-network ids (there is no name service to ask);
 * `types.ts` the type predicates and decoders; `epochs.ts` the Walrus epoch
 * clock every date is projected through; `blobs.ts` the owned-blobs query.
 */
export { WalrusBlobRow } from './components/WalrusBlobRow'
export { isWalrusBlobType } from './types'
export type { WalrusBlob } from './types'
export { walrusBlobStatus } from './blobs'
export { useOwnedWalrusBlobs, BLOB_CAP } from './useOwnedBlobs'
export { useWalrusState } from './useWalrusState'
export type { WalrusState } from './epochs'
