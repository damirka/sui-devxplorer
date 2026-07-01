/**
 * Object fetching over Sui GraphQL. One query gets the overview (version,
 * owner, prev tx, storage rebate) plus the Move struct contents and a first
 * page of dynamic fields. Shapes mirror the schema exactly — see the inline
 * fragments on the `Owner` union and `DynamicFieldValue`.
 */
import { gqlRequest } from './graphql'
import { isUpgradeCapType, upgradeCapData } from './upgradeCap'
import { netGasUsed, type GasSummary } from './gas'
import {
  mapBackwardPage,
  mapPage,
  type Page,
  type PageArgs,
} from './pagination'
import type { MoveFunctionSignature } from './move'
import type { Network } from '@/context/network-context'

const OBJECT_QUERY = `
query Object($address: SuiAddress!, $version: UInt53) {
  object(address: $address, version: $version) {
    address
    version
    digest
    storageRebate
    previousTransaction { digest }
    # Immediate neighbours in this object's version history — drive the version
    # stepper / "historical" detection. A non-empty newerVersion means the node
    # we're showing isn't the latest (i.e. we're viewing a historical snapshot).
    olderVersion: objectVersionsBefore(last: 1) { nodes { version } }
    newerVersion: objectVersionsAfter(first: 1) { nodes { version } }
    owner {
      __typename
      ... on AddressOwner { owner: address { address } }
      ... on ObjectOwner { owner: address { address } }
      ... on ConsensusAddressOwner { startVersion owner: address { address } }
      ... on Shared { initialSharedVersion }
    }
    asMovePackage {
      version
      modules(first: 50) {
        pageInfo { hasNextPage }
        nodes { name }
      }
    }
    asMoveObject {
      hasPublicTransfer
      contents {
        type { repr signature }
        json
        display { output errors }
      }
    }
  }
}
`

export type ObjectOwner =
  | { __typename: 'AddressOwner'; owner: { address: string } }
  | { __typename: 'ObjectOwner'; owner: { address: string } }
  | {
      __typename: 'ConsensusAddressOwner'
      startVersion: number
      owner: { address: string }
    }
  | { __typename: 'Shared'; initialSharedVersion: number }
  | { __typename: 'Immutable' }

export interface DynamicFieldNode {
  address: string
  name: { type: { repr: string }; json: unknown }
  value:
    | { __typename: 'MoveValue'; type: { repr: string }; json: unknown }
    | {
        __typename: 'MoveObject'
        address: string
        /** Version of the object held in this dynamic *object* field. */
        version: number | null
        contents: { type: { repr: string } } | null
      }
}

/** A `{ nodes: [{ version }] }` probe — at most one neighbour version. */
type VersionProbe = { nodes: { version: number }[] }

export interface SuiObject {
  address: string
  version: number | null
  digest: string | null
  storageRebate: string | null
  previousTransaction: { digest: string } | null
  /** The version immediately below the one shown (for stepping back). */
  olderVersion: VersionProbe | null
  /** The version immediately above — non-empty ⇒ this is a historical snapshot. */
  newerVersion: VersionProbe | null
  owner: ObjectOwner | null
  asMovePackage: {
    version: number | null
    modules: {
      pageInfo: { hasNextPage: boolean }
      nodes: { name: string }[]
    } | null
  } | null
  asMoveObject: {
    hasPublicTransfer: boolean | null
    contents: {
      type: { repr: string; signature: unknown }
      json: unknown
      display: { output: unknown; errors: unknown } | null
    } | null
  } | null
}

export interface ObjectResult {
  object: SuiObject | null
  /**
   * Display can fail to render at the resolver level (a malformed format
   * string) — that arrives as a GraphQL field error rather than in
   * `contents.display.errors`. Surfaced here so the view can show it.
   */
  displayError: string | null
}

/**
 * Fetch a single object by id, optionally pinned to a specific `version` (the
 * latest when omitted). `object` is `null` when the id (or that version) doesn't
 * exist.
 */
export async function fetchObject(
  network: Network,
  address: string,
  version: number | null,
  signal?: AbortSignal,
): Promise<ObjectResult> {
  const { data, errors } = await gqlRequest<{ object: SuiObject | null }>(
    network,
    OBJECT_QUERY,
    { address, version },
    signal,
  )
  const displayError =
    errors.find((e) => e.path?.includes('display'))?.message ?? null
  return { object: data.object, displayError }
}

// The producing tx of an object's first (oldest) version = the tx that created
// it. `first: 1` returns that oldest version directly.
const CREATION_TX_QUERY = `
query CreationTx($id: SuiAddress!) {
  objectVersions(address: $id, first: 1) {
    nodes { previousTransaction { digest } }
  }
}
`

/** The digest of the transaction that created an object, or `null` when it can't
 *  be determined (e.g. the genesis version has been pruned). */
export async function fetchCreationTx(
  network: Network,
  id: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { data } = await gqlRequest<{
    objectVersions: { nodes: { previousTransaction: { digest: string } | null }[] }
  }>(network, CREATION_TX_QUERY, { id }, signal)
  return data.objectVersions.nodes[0]?.previousTransaction?.digest ?? null
}

/** An object's version bounds, in ONE round-trip: whether it has any on-chain
 *  version at all (existence), its latest version, and its creating tx. Used to
 *  classify a null-`object()` id (a deleted / wrapped object vs. a plain account
 *  address) and recover its last-known state — instead of two separate first/last
 *  `objectVersions` queries. */
export interface ObjectBounds {
  /** The id has ≥1 on-chain version — i.e. it was (or is, wrapped) an object. */
  exists: boolean
  /** Latest version, to pin the last-known-state snapshot. `null` when none. */
  lastVersion: number | null
  /** The tx that created it (its first version's producing tx). */
  createdTx: string | null
}

// One aliased query for both ends of the version connection — a minimal node
// selection (no owner/effects/gas payload the callers don't read here).
const OBJECT_BOUNDS_QUERY = `
query ObjectBounds($id: SuiAddress!) {
  first: objectVersions(address: $id, first: 1) {
    nodes { previousTransaction { digest } }
  }
  last: objectVersions(address: $id, last: 1) {
    nodes { version }
  }
}
`

export async function fetchObjectBounds(
  network: Network,
  id: string,
  signal?: AbortSignal,
): Promise<ObjectBounds> {
  const { data } = await gqlRequest<{
    first: { nodes: { previousTransaction: { digest: string } | null }[] }
    last: { nodes: { version: number }[] }
  }>(network, OBJECT_BOUNDS_QUERY, { id }, signal)
  const last = data.last.nodes[0]
  return {
    exists: !!last,
    lastVersion: last?.version ?? null,
    createdTx: data.first.nodes[0]?.previousTransaction?.digest ?? null,
  }
}

// An object's full version history. Queried newest-first via `last`/`before`:
// the service returns each page ascending, so we reverse it for display and page
// "back in time" by passing the previous page's `startCursor` as `before`.
const OBJECT_VERSIONS_QUERY = `
query ObjectVersions($address: SuiAddress!, $last: Int!, $before: String) {
  objectVersions(address: $address, last: $last, before: $before) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      version
      digest
      owner {
        __typename
        ... on AddressOwner { owner: address { address } }
        ... on ObjectOwner { owner: address { address } }
        ... on ConsensusAddressOwner { startVersion owner: address { address } }
        ... on Shared { initialSharedVersion }
      }
      previousTransaction {
        digest
        sender { address }
        effects {
          status
          timestamp
          gasEffects { gasSummary { computationCost storageCost storageRebate } }
        }
      }
    }
  }
}
`

export interface ObjectVersionNode {
  version: number
  digest: string | null
  /** The transaction that produced this version. */
  txDigest: string | null
  /** Its sender and execution status — for showing the history as a tx list. */
  sender: string | null
  status: string | null
  timestamp: string | null
  /** Net gas used by the producing tx (computation + storage − rebate, MIST). */
  gas: bigint | null
  /** Who owned the object *at* this version — reveals ownership transfers over
   *  the history. Only meaningful (and shown) for address/object-owned objects. */
  owner: ObjectOwner | null
}

/**
 * One page of an object's version history, newest-first (the `Page` is paged
 * backward in time — its `endCursor` walks to the next, older page). `limit` is
 * capped at 50 by the service.
 */
export async function fetchObjectVersions(
  network: Network,
  address: string,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<ObjectVersionNode>> {
  const { data } = await gqlRequest<{
    objectVersions: {
      pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
      nodes: {
        version: number
        digest: string | null
        owner: ObjectOwner | null
        previousTransaction: {
          digest: string
          sender: { address: string } | null
          effects: {
            status: string | null
            timestamp: string | null
            gasEffects: { gasSummary: GasSummary | null } | null
          } | null
        } | null
      }[]
    }
  }>(
    network,
    OBJECT_VERSIONS_QUERY,
    { address, last: args.limit, before: args.cursor ?? null },
    signal,
  )
  return mapBackwardPage(data.objectVersions, (n) => ({
    version: n.version,
    digest: n.digest,
    txDigest: n.previousTransaction?.digest ?? null,
    sender: n.previousTransaction?.sender?.address ?? null,
    status: n.previousTransaction?.effects?.status ?? null,
    timestamp: n.previousTransaction?.effects?.timestamp ?? null,
    gas: netGasUsed(n.previousTransaction?.effects?.gasEffects?.gasSummary),
    owner: n.owner ?? null,
  }))
}

// How a single object participated in one transaction, via
// `Address.asTransactionObject`. The `ObjectChange` variant carries the object's
// contents immediately before and after the tx (so the caller can diff them);
// `ConsensusObjectRead` means it was only read as an unchanged shared input.
const OBJECT_IN_TX_QUERY = `
query ObjectInTx($address: SuiAddress!, $digest: String!) {
  address(address: $address) {
    asTransactionObject(transactionDigest: $digest) {
      __typename
      ... on ObjectChange {
        idCreated
        idDeleted
        inputState { version asMoveObject { contents { json } } }
        outputState { version asMoveObject { contents { json } } }
      }
      ... on ConsensusObjectRead {
        object { version }
      }
    }
  }
}
`

export interface ObjectTxChange {
  /** `change` = mutated/created/deleted; `read` = unchanged shared input. */
  kind: 'change' | 'read'
  idCreated: boolean
  idDeleted: boolean
  /** Flattened contents before the tx (`null` when created, or on a read). */
  before: unknown | null
  /** Flattened contents after the tx (`null` when deleted, or on a read). */
  after: unknown | null
  beforeVersion: number | null
  afterVersion: number | null
}

/**
 * How a single transaction touched this object — its contents immediately before
 * and after (for a diff), or a `read` when the object was only read as an
 * unchanged shared input. `null` when the tx didn't reference the object.
 */
export async function fetchObjectChangeInTx(
  network: Network,
  objectId: string,
  txDigest: string,
  signal?: AbortSignal,
): Promise<ObjectTxChange | null> {
  type ObjState = {
    version: number | null
    asMoveObject: { contents: { json: unknown } | null } | null
  } | null
  const { data } = await gqlRequest<{
    address: {
      asTransactionObject:
        | {
            __typename: 'ObjectChange'
            idCreated: boolean | null
            idDeleted: boolean | null
            inputState: ObjState
            outputState: ObjState
          }
        | { __typename: 'ConsensusObjectRead'; object: { version: number | null } | null }
        | null
    } | null
  }>(network, OBJECT_IN_TX_QUERY, { address: objectId, digest: txDigest }, signal)

  const o = data.address?.asTransactionObject
  if (!o) return null
  if (o.__typename === 'ConsensusObjectRead') {
    return {
      kind: 'read',
      idCreated: false,
      idDeleted: false,
      before: null,
      after: null,
      beforeVersion: null,
      afterVersion: o.object?.version ?? null,
    }
  }
  return {
    kind: 'change',
    idCreated: !!o.idCreated,
    idDeleted: !!o.idDeleted,
    before: o.inputState?.asMoveObject?.contents?.json ?? null,
    after: o.outputState?.asMoveObject?.contents?.json ?? null,
    beforeVersion: o.inputState?.version ?? null,
    afterVersion: o.outputState?.version ?? null,
  }
}

// A package's `linkage` is the authoritative dependency list: every package it
// links against, with the original (defining) id, the upgraded id actually
// linked, and that dep's on-chain version. Always includes the Sui framework
// (0x1/0x2/0x3) — callers filter those out to show only third-party deps.
const LINKAGE_QUERY = `
query Linkage($address: SuiAddress!) {
  object(address: $address) {
    asMovePackage {
      linkage { originalId upgradedId version }
    }
  }
}
`

export interface PackageLink {
  originalId: string
  upgradedId: string
  version: number
}

/** Fetch a package's dependency linkage (empty when the id isn't a package). */
export async function fetchPackageLinkage(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<PackageLink[]> {
  const { data } = await gqlRequest<{
    object: { asMovePackage: { linkage: PackageLink[] } | null } | null
  }>(network, LINKAGE_QUERY, { address }, signal)
  return data.object?.asMovePackage?.linkage ?? []
}

// Queried via `address(address:)`, not `object(...).asMoveObject`, so dynamic
// fields still resolve for an id that doesn't itself resolve to a Move object
// (e.g. a parent table/bag id that's wrapped or not directly fetchable). The
// `address` root is non-null for any id; the connection is just empty when there
// are none.
const DYNAMIC_FIELDS_QUERY = `
query DynamicFields($address: SuiAddress!, $first: Int, $after: String) {
  address(address: $address) {
    dynamicFields(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        name { type { repr } json }
        value {
          __typename
          ... on MoveValue { type { repr } json }
          ... on MoveObject { address version contents { type { repr } } }
        }
      }
    }
  }
}
`

/**
 * One page of an object's dynamic fields. `limit` is capped at 50 by the
 * service. Returns an empty page for objects that can't hold dynamic fields.
 */
export async function fetchDynamicFields(
  network: Network,
  objectId: string,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<DynamicFieldNode>> {
  const { data } = await gqlRequest<{
    address: {
      dynamicFields: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: DynamicFieldNode[]
      }
    } | null
  }>(
    network,
    DYNAMIC_FIELDS_QUERY,
    { address: objectId, first: args.limit, after: args.cursor ?? null },
    signal,
  )
  return mapPage(data.address?.dynamicFields, (n) => n)
}

// Some framework objects (0x8 Random, 0x9 Bridge) keep their real state in a
// `Versioned`-wrapped value: the object has an `inner: Versioned` field, and that
// Versioned holds the actual `*Inner` struct as its single dynamic field. This
// resolves the nested value object's id in two hops — parent → `inner.id`
// (the Versioned) → that Versioned's lone dynamic field. The id is fixed per
// network, so callers hardcode the well-known networks and only resolve live for
// the rest (devnet / custom). `null` when the object doesn't have this shape.
export interface VersionedInner {
  /** The inner value object's id — the `Versioned`'s single dynamic field. */
  id: string
  /** Its Move value type repr (e.g. `0x3::…::SuiSystemStateInnerV2`), or `null`. */
  type: string | null
}

/**
 * The inner value wrapped by a `0x2::versioned::Versioned` object: the actual
 * `*Inner` struct, held as that Versioned's single dynamic field. One hop from the
 * Versioned object's own id (the `id` of an object's `Versioned` field). Returns
 * the field object's id + value type, or `null` when it has no such field. The id
 * is fixed per network, so this is resolved live wherever the Versioned appears.
 */
export async function fetchVersionedInner(
  network: Network,
  versionedId: string,
  signal?: AbortSignal,
): Promise<VersionedInner | null> {
  const { data } = await gqlRequest<{
    address: {
      dynamicFields: {
        nodes: {
          address: string
          value:
            | { __typename: 'MoveValue'; type: { repr: string } }
            | { __typename: 'MoveObject'; contents: { type: { repr: string } } | null }
        }[]
      }
    } | null
  }>(
    network,
    `query VersionedInner($id: SuiAddress!) {
      address(address: $id) {
        dynamicFields(first: 1) {
          nodes {
            address
            value {
              __typename
              ... on MoveValue { type { repr } }
              ... on MoveObject { contents { type { repr } } }
            }
          }
        }
      }
    }`,
    { id: versionedId },
    signal,
  )
  const node = data.address?.dynamicFields.nodes[0]
  if (!node) return null
  const type =
    node.value.__typename === 'MoveValue'
      ? node.value.type.repr
      : (node.value.contents?.type.repr ?? null)
  return { id: node.address, type }
}

// Sui GraphQL rejects any query over ~5000 bytes (and over 300 nodes). With each
// id inlined (~120 bytes/selection), 30 aliased lookups stays safely under both —
// so a large fan-out (e.g. a PTB with hundreds of object inputs) is split into
// several requests run in parallel rather than one over-limit query.
const OBJECT_TYPES_CHUNK = 30

/**
 * Resolve the concrete Move type of many objects by id. The service has no
 * `objectIds` filter, so we fan out with aliased `object()` selections (ids
 * inlined — they're validated 0x-hex from on-chain data), batched to stay under
 * the query-size cap. Returns a map id → type repr (`null` when the object has
 * no Move type).
 */
export async function fetchObjectTypes(
  network: Network,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out

  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += OBJECT_TYPES_CHUNK) {
    chunks.push(unique.slice(i, i + OBJECT_TYPES_CHUNK))
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const selections = chunk
        .map(
          (id, i) =>
            `o${i}: object(address: "${id}") { asMoveObject { contents { type { repr } } } }`,
        )
        .join('\n')
      const { data } = await gqlRequest<
        Record<string, { asMoveObject: { contents: { type: { repr: string } } | null } | null } | null>
      >(network, `query ObjectTypes {\n${selections}\n}`, {}, signal)
      chunk.forEach((id, i) => {
        out.set(id, data[`o${i}`]?.asMoveObject?.contents?.type.repr ?? null)
      })
    }),
  )
  return out
}

const TYPE_DEF_QUERY = `
query TypeDef($package: SuiAddress!, $module: String!, $name: String!) {
  object(address: $package) {
    asMovePackage {
      module(name: $module) {
        struct(name: $name) {
          name
          abilities
          typeParameters { isPhantom constraints }
          fields { name type { repr signature } }
        }
      }
    }
  }
}
`

/** The `signature.datatype` shape on a `MoveType` — identifies the defining struct. */
interface TypeSignature {
  datatype?: { package: string; module: string; type: string }
}

export interface TypeDefinition {
  name: string
  abilities: string[]
  typeParameters: { isPhantom: boolean; constraints: string[] }[]
  /** `type.signature` is the `OpenMoveTypeSignature` JSON (`{ body: … }`). */
  fields: { name: string; type: { repr: string; signature: unknown } }[]
}

/**
 * Fetch the source struct definition for a Move type — abilities, type params,
 * and fields with their declared types — from the defining package's module.
 * Resolved from `MoveType.signature.datatype`. `null` for non-structs (enums)
 * or when the definition can't be found.
 */
export async function fetchTypeDefinition(
  network: Network,
  signature: unknown,
  signal?: AbortSignal,
): Promise<TypeDefinition | null> {
  const dt = (signature as TypeSignature | null)?.datatype
  if (!dt) return null
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: { module: { struct: TypeDefinition | null } | null } | null
    } | null
  }>(
    network,
    TYPE_DEF_QUERY,
    { package: dt.package, module: dt.module, name: dt.type },
    signal,
  )
  return data.object?.asMovePackage?.module?.struct ?? null
}

/**
 * Fetch a struct definition by explicit `package::module::name` coordinates
 * (as opposed to deriving them from a type signature). Used when navigating to
 * a type path directly. `null` for enums or when the struct isn't found.
 */
export async function fetchStructByPath(
  network: Network,
  packageId: string,
  module: string,
  name: string,
  signal?: AbortSignal,
): Promise<TypeDefinition | null> {
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: { module: { struct: TypeDefinition | null } | null } | null
    } | null
  }>(network, TYPE_DEF_QUERY, { package: packageId, module, name }, signal)
  return data.object?.asMovePackage?.module?.struct ?? null
}

// A package's `typeOrigins` maps each struct → the package id where it was first
// defined (`definingId`). The top-level `objects` type-filter ONLY matches that
// defining id — filtering by a later *upgraded* package id returns nothing — so a
// type reached via an upgraded id must be resolved back to its defining id first.
const TYPE_ORIGINS_QUERY = `
query TypeOrigins($address: SuiAddress!) {
  object(address: $address) {
    asMovePackage {
      typeOrigins { module struct definingId }
    }
  }
}
`

/**
 * Resolve the *defining* package id of a struct (the id its objects' type repr
 * carries, and the only one the `objects` type-filter matches). Looks the struct
 * up in the package's `typeOrigins`; available from any version of the package.
 * `null` when the struct isn't found there (caller falls back to the queried id,
 * which is usually already the defining id).
 */
export async function fetchTypeDefiningId(
  network: Network,
  packageId: string,
  module: string,
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: {
        typeOrigins: { module: string; struct: string; definingId: string }[]
      } | null
    } | null
  }>(network, TYPE_ORIGINS_QUERY, { address: packageId }, signal)
  const origins = data.object?.asMovePackage?.typeOrigins ?? []
  return (
    origins.find((o) => o.module === module && o.struct === name)?.definingId ??
    null
  )
}

// Every object of a Move type, network-wide — the top-level `objects` connection
// filtered by type (NOT scoped to an owner like `fetchOwnedPage`). Its nodes are
// `Object` (not `MoveObject`), so contents go through `asMoveObject`. A *base*
// type with no type args (`pkg::mod::Pool`) matches all type-arg combos
// (`Pool<A,B>`, `Pool<C,D>`, …) — the concrete repr per node tells them apart.
const OBJECTS_BY_TYPE_QUERY = `
query ObjectsByType($type: String!, $first: Int, $after: String) {
  objects(first: $first, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      address
      owner {
        __typename
        ... on AddressOwner { owner: address { address } }
        ... on ObjectOwner { owner: address { address } }
        ... on ConsensusAddressOwner { startVersion owner: address { address } }
        ... on Shared { initialSharedVersion }
      }
      asMoveObject {
        contents {
          type { repr }
          display { output }
        }
      }
    }
  }
}
`

export interface TypeObject {
  address: string
  /** The object's concrete type repr — carries the generic args for a base-type
   *  filter (so `Pool<A,B>` instances are distinguishable). */
  type: string | null
  /** Rendered Display `name` / `description`, when the object has a Display. */
  name: string | null
  description: string | null
  owner: ObjectOwner | null
}

/**
 * One page of the objects of a given Move type, network-wide. Pass the *defining*
 * type (`fetchTypeDefiningId`-resolved) — an upgraded-id filter matches nothing.
 * `limit` is capped at 50 by the service. Empty page when the type has no live
 * objects (e.g. it isn't a `key` struct, or none exist).
 */
export async function fetchObjectsByType(
  network: Network,
  type: string,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<TypeObject>> {
  const { data } = await gqlRequest<{
    objects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: {
        address: string
        owner: ObjectOwner | null
        asMoveObject: {
          contents: {
            type: { repr: string }
            display: { output: unknown } | null
          } | null
        } | null
      }[]
    }
  }>(
    network,
    OBJECTS_BY_TYPE_QUERY,
    { type, first: args.limit, after: args.cursor ?? null },
    signal,
  )
  return mapPage(data.objects, (n) => {
    const output = n.asMoveObject?.contents?.display?.output ?? null
    return {
      address: n.address,
      type: n.asMoveObject?.contents?.type.repr ?? null,
      name: displayField(output, 'name'),
      description: displayField(output, 'description'),
      owner: n.owner ?? null,
    }
  })
}

const FUNCTION_DEF_QUERY = `
query FunctionDef($package: SuiAddress!, $module: String!, $name: String!) {
  object(address: $package) {
    asMovePackage {
      module(name: $module) {
        function(name: $name) {
          name
          visibility
          isEntry
          typeParameters { constraints }
          parameters { repr }
          return { repr }
        }
      }
    }
  }
}
`

/** A package module's declared function signature. */
export type MoveFunctionDef = MoveFunctionSignature

/**
 * Fetch a function's structured signature (visibility, type params, parameter
 * and return type reprs) from a module. `null` when the package/module has no
 * function by that name — used to tell a `addr::module::name` path apart from a
 * struct/enum of the same shape.
 */
export async function fetchFunctionSignature(
  network: Network,
  packageId: string,
  module: string,
  name: string,
  signal?: AbortSignal,
): Promise<MoveFunctionDef | null> {
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: {
        module: { function: MoveFunctionDef | null } | null
      } | null
    } | null
  }>(network, FUNCTION_DEF_QUERY, { package: packageId, module, name }, signal)
  return data.object?.asMovePackage?.module?.function ?? null
}

const MODULE_QUERY = `
query Module($address: SuiAddress!, $module: String!) {
  object(address: $address) {
    asMovePackage {
      module(name: $module) {
        name
        fileFormatVersion
        disassembly
      }
    }
  }
}
`

export interface MoveModule {
  name: string
  fileFormatVersion: number | null
  /** Human-readable bytecode disassembly (NOT decompiled Move source). */
  disassembly: string | null
}

/**
 * Fetch one module's bytecode disassembly from a package. This is the
 * `sui move disassemble` output — readable, but not the original source.
 * `null` when the package or module doesn't exist.
 */
export async function fetchModule(
  network: Network,
  packageId: string,
  moduleName: string,
  signal?: AbortSignal,
): Promise<MoveModule | null> {
  const { data } = await gqlRequest<{
    object: { asMovePackage: { module: MoveModule | null } | null } | null
  }>(network, MODULE_QUERY, { address: packageId, module: moduleName }, signal)
  return data.object?.asMovePackage?.module ?? null
}

const PACKAGE_MODULES_QUERY = `
query PackageModules($address: SuiAddress!, $after: String) {
  object(address: $address) {
    asMovePackage {
      modules(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          datatypes(first: 50) { nodes { name } }
        }
      }
    }
  }
}
`

export interface PackageModuleInfo {
  name: string
  /** Names of the module's datatypes (structs + enums) — for struct search.
   * Capped at 50 per module by the service (rare to exceed). */
  datatypes: string[]
}

/** One page of a package's modules (each with its datatype names). */
async function fetchModulesPage(
  network: Network,
  packageId: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<Page<PackageModuleInfo>> {
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: {
        modules: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: { name: string; datatypes: { nodes: { name: string }[] } }[]
        }
      } | null
    } | null
  }>(network, PACKAGE_MODULES_QUERY, { address: packageId, after }, signal)
  return mapPage(data.object?.asMovePackage?.modules, (n) => ({
    name: n.name,
    datatypes: n.datatypes.nodes.map((d) => d.name),
  }))
}

/**
 * Every module in a package (paginating past the 50-per-page service cap that
 * the object query only carries one page of), each with its datatype names.
 * Lets the module browser list, filter, and struct-search the full set.
 */
export async function fetchAllModules(
  network: Network,
  packageId: string,
  signal?: AbortSignal,
): Promise<PackageModuleInfo[]> {
  const mods: PackageModuleInfo[] = []
  let after: string | null = null
  for (;;) {
    const page = await fetchModulesPage(network, packageId, after, signal)
    mods.push(...page.items)
    if (!page.hasNextPage) break
    after = page.endCursor
  }
  return mods
}

// A type's Display can be registered in either of two on-chain systems: the
// modern `0x2::display_registry::Display<T>` or the legacy `0x2::display::
// Display<T>`. Both hold the same `fields` VecMap template; we fetch both (one
// query, aliased) and report which one backs the rendered output.
const DISPLAY_DEF_QUERY = `
query DisplayDef($modern: String!, $legacy: String!) {
  modern: objects(first: 1, filter: { type: $modern }) {
    nodes { address asMoveObject { contents { json } } }
  }
  legacy: objects(first: 1, filter: { type: $legacy }) {
    nodes { address asMoveObject { contents { json } } }
  }
}
`

export interface DisplayDefinition {
  /** The Display<T> object that holds the template (the "registry" entry). */
  address: string
  version: number | null
  /** The raw template: field name → format string with `{placeholders}`. */
  fields: { key: string; value: string }[]
  /** Which Display system it lives in: `true` = legacy `0x2::display::Display<T>`,
   *  `false` = modern `0x2::display_registry::Display<T>`. */
  legacy: boolean
}

interface DisplayContentsJson {
  fields?: { contents?: { key: string; value: string }[] }
  version?: number
}

type DisplayNode = {
  address: string
  asMoveObject: { contents: { json: unknown } | null } | null
}

/**
 * Fetch the on-chain Display definition for a Move type — the `Display<T>`
 * object whose `fields` VecMap holds the unrendered templates that
 * `MoveValue.display.output` is computed from. Looks up both the modern
 * (`0x2::display_registry`) and legacy (`0x2::display`) systems, preferring the
 * modern one when both exist (it supersedes the legacy entry). `null` when
 * neither is set.
 */
export async function fetchDisplayDefinition(
  network: Network,
  objectType: string,
  signal?: AbortSignal,
): Promise<DisplayDefinition | null> {
  const { data } = await gqlRequest<{
    modern: { nodes: DisplayNode[] }
    legacy: { nodes: DisplayNode[] }
  }>(
    network,
    DISPLAY_DEF_QUERY,
    {
      modern: `0x2::display_registry::Display<${objectType}>`,
      legacy: `0x2::display::Display<${objectType}>`,
    },
    signal,
  )

  const modern = data.modern.nodes[0]
  const node = modern ?? data.legacy.nodes[0]
  const json = node?.asMoveObject?.contents?.json as
    | DisplayContentsJson
    | undefined
  if (!node || !json) return null

  return {
    address: node.address,
    version: json.version ?? null,
    fields: json.fields?.contents ?? [],
    legacy: !modern,
  }
}

const OWNED_QUERY = `
query Owned($address: SuiAddress!, $first: Int, $after: String, $filter: ObjectFilter, $withDisplay: Boolean!) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: $filter) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        contents {
          type { repr }
          display @include(if: $withDisplay) { output }
        }
      }
    }
  }
}
`

export interface OwnedObject {
  address: string
  type: string | null
  /** Rendered Display `name` / `description`, when the object has a Display. */
  name: string | null
  description: string | null
}

interface OwnedQueryResult {
  address: {
    objects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: {
        address: string
        contents: {
          type: { repr: string }
          display?: { output: unknown } | null
        } | null
      }[]
    }
  } | null
}

/** Pull a string field (name/description/…) out of a rendered display.output map. */
function displayField(output: unknown, key: string): string | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const v = (output as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * One page of objects owned by an address — or by an object (ownership is by
 * address, so an object id works as the owner too). Id + type only; version is
 * intentionally omitted. `first` is capped at 50 by the service. Used both for
 * the paginated list and for the background full-ownership scan.
 */
export async function fetchOwnedPage(
  network: Network,
  ownerId: string,
  opts: PageArgs & {
    type?: string | null
    /** Also fetch each object's rendered Display (name/description). Off by
     * default so the full-ownership type scan stays lean. */
    display?: boolean
  },
  signal?: AbortSignal,
): Promise<Page<OwnedObject>> {
  const { data } = await gqlRequest<OwnedQueryResult>(
    network,
    OWNED_QUERY,
    {
      address: ownerId,
      first: opts.limit,
      after: opts.cursor ?? null,
      filter: opts.type ? { type: opts.type } : null,
      withDisplay: opts.display ?? false,
    },
    signal,
  )
  return mapPage(data.address?.objects, (n) => {
    const output = n.contents?.display?.output ?? null
    return {
      address: n.address,
      type: n.contents?.type.repr ?? null,
      name: displayField(output, 'name'),
      description: displayField(output, 'description'),
    }
  })
}

// The UpgradeCaps an owner holds. Filtered server-side by the cap's type
// (`0x2::package::UpgradeCap` — the type filter resolves it to its defining id,
// `0x2`). Pulls each cap's `contents.json` so the caller can read the governed
// package / version / policy without a follow-up fetch.
const OWNED_UPGRADE_CAPS_QUERY = `
query OwnedUpgradeCaps($address: SuiAddress!, $first: Int, $after: String) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: { type: "0x2::package::UpgradeCap" }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        contents { type { repr } json }
      }
    }
  }
}
`

export interface OwnedUpgradeCapNode {
  /** The UpgradeCap object's own id. */
  address: string
  /** Its concrete type repr (for the caller to confirm/parse). */
  type: string | null
  /** Flattened Move contents (`{ id, package, version, policy }`). */
  json: unknown
}

/**
 * One page of the `0x2::package::UpgradeCap` objects owned by an address (or by
 * an object — ownership is by address, so an object id works as the owner too).
 * `limit` is capped at 50 by the service. Empty page when the owner holds none.
 */
export async function fetchOwnedUpgradeCaps(
  network: Network,
  ownerId: string,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<OwnedUpgradeCapNode>> {
  const { data } = await gqlRequest<{
    address: {
      objects: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: {
          address: string
          contents: { type: { repr: string }; json: unknown } | null
        }[]
      }
    } | null
  }>(
    network,
    OWNED_UPGRADE_CAPS_QUERY,
    { address: ownerId, first: args.limit, after: args.cursor ?? null },
    signal,
  )
  return mapPage(data.address?.objects, (n) => ({
    address: n.address,
    type: n.contents?.type.repr ?? null,
    json: n.contents?.json ?? null,
  }))
}

// The `0x2::package::Publisher` objects an owner holds. Each Publisher proves
// authority over the package+module it was claimed from; those live in its
// `contents.json` (`{ package, module_name }`), so we pull the json (no Display).
const OWNED_PUBLISHERS_QUERY = `
query OwnedPublishers($address: SuiAddress!, $first: Int, $after: String) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: { type: "0x2::package::Publisher" }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        contents { json }
      }
    }
  }
}
`

export interface OwnedPublisher {
  /** The Publisher object's own id. */
  address: string
  /** The package it was claimed from, `0x`-prefixed (json stores it bare), or null. */
  package: string | null
  /** The module within that package the claiming witness came from. */
  moduleName: string | null
}

/**
 * One page of the `0x2::package::Publisher` objects owned by an address (or
 * object — ownership is by address). `limit` is capped at 50. Empty when none.
 */
export async function fetchOwnedPublishers(
  network: Network,
  ownerId: string,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<OwnedPublisher>> {
  const { data } = await gqlRequest<{
    address: {
      objects: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { address: string; contents: { json: unknown } | null }[]
      }
    } | null
  }>(
    network,
    OWNED_PUBLISHERS_QUERY,
    { address: ownerId, first: args.limit, after: args.cursor ?? null },
    signal,
  )
  return mapPage(data.address?.objects, (n) => {
    const json = (n.contents?.json ?? {}) as {
      package?: unknown
      module_name?: unknown
    }
    const pkg = typeof json.package === 'string' ? json.package : null
    return {
      address: n.address,
      package: pkg ? '0x' + pkg.replace(/^0x/, '') : null,
      moduleName: typeof json.module_name === 'string' ? json.module_name : null,
    }
  })
}

// Finding the UpgradeCap that governs a package has no direct GraphQL filter
// (there's no "objects whose `package` field == X" query). The reliable route
// is the package's publish transaction (its v1 `previousTransaction`), which
// created the cap — and the cap's object id is stable across every later
// upgrade. Three steps: v1 publish tx → the cap created in it → the cap's
// *current* owner/state (it may since have been transferred or burned).

const PACKAGE_PUBLISH_QUERY = `
query PackagePublish($address: SuiAddress!) {
  object(address: $address) {
    asMovePackage {
      packageAt(version: 1) {
        address
        previousTransaction { digest sender { address } }
      }
    }
  }
}
`

const PUBLISH_OBJECT_CHANGES_QUERY = `
query PublishObjectChanges($digest: String!, $after: String) {
  transaction(digest: $digest) {
    effects {
      objectChanges(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          address
          outputState {
            asMoveObject { contents { type { repr } json } }
          }
        }
      }
    }
  }
}
`

const UPGRADE_CAP_STATE_QUERY = `
query UpgradeCapState($address: SuiAddress!) {
  object(address: $address) {
    owner {
      __typename
      ... on AddressOwner { owner: address { address } }
      ... on ObjectOwner { owner: address { address } }
      ... on ConsensusAddressOwner { startVersion owner: address { address } }
      ... on Shared { initialSharedVersion }
    }
    asMoveObject { contents { type { repr } json } }
  }
}
`

/** One page of the UpgradeCaps created in a publish tx (each with the `package`
 * id it was minted for, so the caller can match the right one). */
async function fetchPublishCaps(
  network: Network,
  digest: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<{
  caps: { address: string; pkg: string | null }[]
  hasNextPage: boolean
  endCursor: string | null
}> {
  const { data } = await gqlRequest<{
    transaction: {
      effects: {
        objectChanges: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: {
            address: string
            outputState: {
              asMoveObject: {
                contents: { type: { repr: string }; json: unknown } | null
              } | null
            } | null
          }[]
        }
      }
    } | null
  }>(network, PUBLISH_OBJECT_CHANGES_QUERY, { digest, after }, signal)
  const conn = data.transaction?.effects.objectChanges
  if (!conn) return { caps: [], hasNextPage: false, endCursor: null }
  const caps = conn.nodes.flatMap((n) => {
    const contents = n.outputState?.asMoveObject?.contents
    if (!contents || !isUpgradeCapType(contents.type.repr)) return []
    const pkg = (contents.json as { package?: string } | null)?.package ?? null
    return [{ address: n.address, pkg }]
  })
  return {
    caps,
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

export interface PackageUpgradeCap {
  /** The UpgradeCap object id — stable across the package's whole upgrade chain. */
  capId: string
  /** False when the cap has been destroyed → the package is now immutable. */
  exists: boolean
  /** The cap's current owner (when it still exists). */
  owner: ObjectOwner | null
  /** The package version the cap is currently at. */
  version: string | null
  /** The current upgrade-policy byte. */
  policy: number | null
}

/**
 * The UpgradeCap governing a package, resolved via its publish transaction (see
 * the note above). `null` when the package has no cap to find — a system /
 * genesis package (no normal publish tx), or a publish whose cap we can't match.
 * When the cap was burned since publish, `exists` is false (owner/version null).
 */
export async function fetchPackageUpgradeCap(
  network: Network,
  packageId: string,
  signal?: AbortSignal,
): Promise<PackageUpgradeCap | null> {
  // 1. The package's v1 (original) id + the tx that published it. A null sender
  //    means a system/genesis tx (the framework packages) — never a normal
  //    publish, so there's no UpgradeCap to find; bail before scanning the huge
  //    genesis object-change set.
  const { data: pub } = await gqlRequest<{
    object: {
      asMovePackage: {
        packageAt: {
          address: string
          previousTransaction: {
            digest: string
            sender: { address: string } | null
          } | null
        } | null
      } | null
    } | null
  }>(network, PACKAGE_PUBLISH_QUERY, { address: packageId }, signal)
  const v1 = pub.object?.asMovePackage?.packageAt
  const originalId = v1?.address
  const digest = v1?.previousTransaction?.digest
  if (!originalId || !digest || !v1?.previousTransaction?.sender) return null

  // 2. The UpgradeCap created in that publish tx. A publish PTB can publish
  //    several packages (each with its own cap), so match the one whose
  //    `package` field is this package's original id; fall back to the sole cap
  //    when there's exactly one and the field can't be read.
  const candidates: string[] = []
  let matched: string | null = null
  let after: string | null = null
  for (;;) {
    const page = await fetchPublishCaps(network, digest, after, signal)
    for (const c of page.caps) {
      if (c.pkg === originalId) {
        matched = c.address
        break
      }
      candidates.push(c.address)
    }
    if (matched || !page.hasNextPage) break
    after = page.endCursor
  }
  const capId = matched ?? (candidates.length === 1 ? candidates[0] : null)
  if (!capId) return null

  // 3. The cap's *current* state — owner (it's often transferred away from the
  //    publisher) and version/policy, or non-existence if it was burned.
  const { data: state } = await gqlRequest<{
    object: {
      owner: ObjectOwner | null
      asMoveObject: {
        contents: { type: { repr: string }; json: unknown } | null
      } | null
    } | null
  }>(network, UPGRADE_CAP_STATE_QUERY, { address: capId }, signal)
  const obj = state.object
  if (!obj) {
    return { capId, exists: false, owner: null, version: null, policy: null }
  }
  const cap = upgradeCapData(
    obj.asMoveObject?.contents?.type.repr ?? null,
    obj.asMoveObject?.contents?.json ?? null,
  )
  return {
    capId,
    exists: true,
    owner: obj.owner,
    version: cap?.version ?? null,
    policy: cap?.policy ?? null,
  }
}

/** Collapse the owner union into a label + optional address for display. */
export function describeOwner(
  owner: ObjectOwner | null,
): { kind: string; address?: string } {
  if (!owner) return { kind: 'unknown' }
  switch (owner.__typename) {
    case 'AddressOwner':
      return { kind: 'address', address: owner.owner.address }
    case 'ObjectOwner':
      return { kind: 'object', address: owner.owner.address }
    case 'ConsensusAddressOwner':
      return { kind: 'consensus address', address: owner.owner.address }
    case 'Shared':
      return { kind: `shared (v${owner.initialSharedVersion})` }
    case 'Immutable':
      return { kind: 'immutable' }
  }
}
