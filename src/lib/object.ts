/**
 * Object fetching over Sui GraphQL. One query gets the overview (version,
 * owner, prev tx, storage rebate) plus the Move struct contents and a first
 * page of dynamic fields. Shapes mirror the schema exactly — see the inline
 * fragments on the `Owner` union and `DynamicFieldValue`.
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'

const OBJECT_QUERY = `
query Object($address: SuiAddress!) {
  object(address: $address) {
    address
    version
    digest
    storageRebate
    previousTransaction { digest }
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
        contents: { type: { repr: string } } | null
      }
}

export interface SuiObject {
  address: string
  version: number | null
  digest: string | null
  storageRebate: string | null
  previousTransaction: { digest: string } | null
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

/** Fetch a single object by id. `object` is `null` when the id doesn't exist. */
export async function fetchObject(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<ObjectResult> {
  const { data, errors } = await gqlRequest<{ object: SuiObject | null }>(
    network,
    OBJECT_QUERY,
    { address },
    signal,
  )
  const displayError =
    errors.find((e) => e.path?.includes('display'))?.message ?? null
  return { object: data.object, displayError }
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
          ... on MoveObject { address contents { type { repr } } }
        }
      }
    }
  }
}
`

export interface DynamicFieldPage {
  fields: DynamicFieldNode[]
  hasNextPage: boolean
  endCursor: string | null
}

/**
 * One page of an object's dynamic fields. `first` is capped at 50 by the
 * service. Returns an empty page for objects that can't hold dynamic fields.
 */
export async function fetchDynamicFields(
  network: Network,
  objectId: string,
  opts: { first: number; after?: string | null },
  signal?: AbortSignal,
): Promise<DynamicFieldPage> {
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
    { address: objectId, first: opts.first, after: opts.after ?? null },
    signal,
  )
  const conn = data.address?.dynamicFields
  if (!conn) return { fields: [], hasNextPage: false, endCursor: null }
  return {
    fields: conn.nodes,
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

/**
 * Resolve the concrete Move type of many objects in a single request, by id.
 * The service has no `objectIds` filter, so we fan out with aliased `object()`
 * selections. Ids are inlined (they're validated 0x-hex from on-chain data).
 * Returns a map id → type repr (`null` when the object has no Move type).
 */
export async function fetchObjectTypes(
  network: Network,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (ids.length === 0) return out
  const selections = ids
    .map(
      (id, i) =>
        `o${i}: object(address: "${id}") { asMoveObject { contents { type { repr } } } }`,
    )
    .join('\n')
  const { data } = await gqlRequest<
    Record<string, { asMoveObject: { contents: { type: { repr: string } } | null } | null } | null>
  >(network, `query ObjectTypes {\n${selections}\n}`, {}, signal)
  ids.forEach((id, i) => {
    out.set(id, data[`o${i}`]?.asMoveObject?.contents?.type.repr ?? null)
  })
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

const DISPLAY_DEF_QUERY = `
query DisplayDef($type: String!) {
  objects(first: 1, filter: { type: $type }) {
    nodes {
      address
      asMoveObject { contents { json } }
    }
  }
}
`

export interface DisplayDefinition {
  /** The Display<T> object that holds the template (the "registry" entry). */
  address: string
  version: number | null
  /** The raw template: field name → format string with `{placeholders}`. */
  fields: { key: string; value: string }[]
}

interface DisplayContentsJson {
  fields?: { contents?: { key: string; value: string }[] }
  version?: number
}

/**
 * Fetch the on-chain Display definition for a Move type — the `0x2::display::
 * Display<T>` object whose `fields` VecMap holds the unrendered templates that
 * `MoveValue.display.output` is computed from. `null` when no Display is set.
 */
export async function fetchDisplayDefinition(
  network: Network,
  objectType: string,
  signal?: AbortSignal,
): Promise<DisplayDefinition | null> {
  const type = `0x2::display::Display<${objectType}>`
  const { data } = await gqlRequest<{
    objects: {
      nodes: {
        address: string
        asMoveObject: { contents: { json: unknown } | null } | null
      }[]
    }
  }>(network, DISPLAY_DEF_QUERY, { type }, signal)

  const node = data.objects.nodes[0]
  const json = node?.asMoveObject?.contents?.json as
    | DisplayContentsJson
    | undefined
  if (!node || !json) return null

  return {
    address: node.address,
    version: json.version ?? null,
    fields: json.fields?.contents ?? [],
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

export interface OwnedPage {
  objects: OwnedObject[]
  hasNextPage: boolean
  endCursor: string | null
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
  opts: {
    first: number
    after?: string | null
    type?: string | null
    /** Also fetch each object's rendered Display (name/description). Off by
     * default so the full-ownership type scan stays lean. */
    display?: boolean
  },
  signal?: AbortSignal,
): Promise<OwnedPage> {
  const { data } = await gqlRequest<OwnedQueryResult>(
    network,
    OWNED_QUERY,
    {
      address: ownerId,
      first: opts.first,
      after: opts.after ?? null,
      filter: opts.type ? { type: opts.type } : null,
      withDisplay: opts.display ?? false,
    },
    signal,
  )
  const conn = data.address?.objects
  if (!conn) return { objects: [], hasNextPage: false, endCursor: null }
  return {
    objects: conn.nodes.map((n) => {
      const output = n.contents?.display?.output ?? null
      return {
        address: n.address,
        type: n.contents?.type.repr ?? null,
        name: displayField(output, 'name'),
        description: displayField(output, 'description'),
      }
    }),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
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
