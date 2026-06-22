/**
 * Transaction fetching. The execution *results* (status, gas charged, object /
 * balance changes, events) come from Sui GraphQL `effects`; the transaction
 * *definition* (sender, gas, typed inputs, and the command pipeline with decoded
 * argument wiring + concrete type arguments) is decoded locally from the compact
 * `transactionBcs` using the SDK's `TransactionData` schema. Object-input types
 * and MoveCall function signatures — the enrichment the structured GraphQL would
 * have inlined (and duplicated per call) — are resolved in batched, session-
 * cached follow-ups. The exported `SuiTransaction` shape is unchanged, so the
 * views consume it exactly as before.
 */
import { bcs, type BcsType } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { gqlRequest } from './graphql'
import { escapeRegExp } from './format'
import { fetchObjectTypes } from './object'
import { netGasUsed, type GasSummary } from './gas'
import { mapBackwardPage, type Page, type PageArgs } from './pagination'
import type { MoveFunctionSignature } from './move'
import type { Network } from '@/context/network-context'

// The whole transaction *definition* (gas, inputs, commands + concrete type
// args) is decoded locally from `transactionBcs` — far smaller on the wire than
// the structured `inputs`/`commands` tree (which re-fetched every object type +
// a full function signature *per call*); that enrichment now comes from cached,
// batched follow-ups. `digest`/`kind`/`sender` stay as tiny scalars so system
// transactions — whose kinds the SDK BCS schema can't decode and which carry no
// commands anyway — still render. (Effects stay on GraphQL; a future step could
// move those to BCS too.)
const TRANSACTION_QUERY = `
query Transaction($digest: String!) {
  transaction(digest: $digest) {
    digest
    kind { __typename }
    sender { address }
    transactionBcs
    effects {
      status
      timestamp
      checkpoint { sequenceNumber }
      epoch { epochId }
      executionError { abortCode message identifier }
      gasEffects {
        gasSummary {
          computationCost
          storageCost
          storageRebate
          nonRefundableStorageFee
        }
      }
      objectChanges(first: 50) {
        pageInfo { hasNextPage }
        nodes {
          address
          idCreated
          idDeleted
          inputState {
            asMoveObject { contents { type { repr } } }
          }
          outputState {
            asMoveObject { contents { type { repr } } }
            asMovePackage { version }
          }
        }
      }
      balanceChanges(first: 50) {
        pageInfo { hasNextPage }
        nodes { owner { address } amount coinType { repr } }
      }
      events(first: 50) {
        pageInfo { hasNextPage }
        nodes {
          sender { address }
          contents { type { repr } json }
        }
      }
    }
  }
}
`


/** A reference an argument points at: the gas coin, an input, or a prior result. */
export type TxArgument =
  | { __typename: 'GasCoin' }
  | { __typename: 'Input'; ix: number }
  | { __typename: 'TxResult'; cmd: number; ix: number | null }

/** An object referenced by an input, carrying its resolved Move type. */
export interface InputObject {
  address: string
  version: number | null
  asMoveObject: { contents: { type: { repr: string } } | null } | null
}

export type TxInput =
  | { __typename: 'Pure'; bytes: string }
  | { __typename: 'MoveValue'; type: { repr: string }; json: unknown }
  | { __typename: 'OwnedOrImmutable'; object: InputObject }
  | {
      __typename: 'SharedInput'
      address: string
      initialSharedVersion: number
      mutable: boolean
      /** Resolved out-of-band via `fetchObjectTypes` — shared inputs don't expose it. */
      type?: string | null
    }
  | { __typename: 'Receiving'; object: InputObject }
  | { __typename: 'BalanceWithdraw'; type: { repr: string } | null }

/** The non-programmable `TransactionKind` members — system transactions. */
export type SystemTransactionKind =
  | 'GenesisTransaction'
  | 'ConsensusCommitPrologueTransaction'
  | 'ChangeEpochTransaction'
  | 'RandomnessStateUpdateTransaction'
  | 'AuthenticatorStateUpdateTransaction'
  | 'EndOfEpochTransaction'
  | 'ProgrammableSystemTransaction'

/** The function a transaction's MoveCall targets — a Move function signature
 *  plus where it's defined. */
export interface MoveFn extends MoveFunctionSignature {
  module: { package: { address: string }; name: string }
}

export type TxCommand =
  | {
      __typename: 'MoveCallCommand'
      function: MoveFn | null
      arguments: TxArgument[]
      /**
       * Concrete type arguments of this call (e.g. `0x2::sui::SUI`), in
       * declaration order — one per the function's type parameters. Absent from
       * the structured schema; attached from `transactionJson` at fetch time
       * (`[]` for a non-generic call).
       */
      typeArguments: string[]
    }
  | { __typename: 'SplitCoinsCommand'; coin: TxArgument; amounts: TxArgument[] }
  | { __typename: 'TransferObjectsCommand'; inputs: TxArgument[]; address: TxArgument }
  | { __typename: 'MergeCoinsCommand'; coin: TxArgument; coins: TxArgument[] }
  | {
      __typename: 'MakeMoveVecCommand'
      type: { repr: string } | null
      elements: TxArgument[]
    }
  | { __typename: 'PublishCommand'; modules: string[]; dependencies: string[] }
  | {
      __typename: 'UpgradeCommand'
      modules: string[]
      dependencies: string[]
      currentPackage: string
      upgradeTicket: TxArgument
    }

export interface ObjectChangeNode {
  address: string
  idCreated: boolean | null
  idDeleted: boolean | null
  /** State before the tx — the only place a *deleted* object's type survives. */
  inputState: {
    asMoveObject: { contents: { type: { repr: string } } | null } | null
  } | null
  outputState: {
    asMoveObject: { contents: { type: { repr: string } } | null } | null
    asMovePackage: { version: number | null } | null
  } | null
}

export interface BalanceChangeNode {
  owner: { address: string } | null
  amount: string | null
  coinType: { repr: string } | null
}

export interface EventNode {
  sender: { address: string } | null
  contents: { type: { repr: string }; json: unknown } | null
}

interface Connection<T> {
  pageInfo: { hasNextPage: boolean }
  nodes: T[]
}

export interface SuiTransaction {
  digest: string | null
  sender: { address: string } | null
  gasInput: {
    gasSponsor: { address: string } | null
    gasPrice: string | null
    gasBudget: string | null
    gasPayment: { nodes: { address: string }[] } | null
  } | null
  kind:
    | {
        __typename: 'ProgrammableTransaction'
        inputs: Connection<TxInput>
        commands: Connection<TxCommand>
      }
    | { __typename: SystemTransactionKind }
    | null
  effects: {
    status: 'SUCCESS' | 'FAILURE' | null
    timestamp: string | null
    checkpoint: { sequenceNumber: number } | null
    epoch: { epochId: number } | null
    executionError: {
      abortCode: string | null
      message: string | null
      identifier: string | null
    } | null
    gasEffects: { gasSummary: GasSummary | null } | null
    objectChanges: Connection<ObjectChangeNode>
    balanceChanges: Connection<BalanceChangeNode>
    events: Connection<EventNode>
  } | null
}

/** The GraphQL response: everything BCS can't give us. The definition is decoded
 *  from `transactionBcs`; `kind`/`sender` stay as scalars so system transactions
 *  (not BCS-decodable, no commands) still render from their effects. */
interface TxQueryResult {
  digest: string | null
  kind: { __typename: string } | null
  sender: { address: string } | null
  transactionBcs: string | null
  effects: SuiTransaction['effects']
}

/**
 * Fetch a transaction by digest. `null` when not found. For a programmable
 * transaction the whole definition is decoded locally from `transactionBcs`,
 * with object-input types and function signatures resolved in batched, cached
 * follow-ups; system transactions render from `kind`/`sender`/`effects` alone.
 */
export async function fetchTransaction(
  network: Network,
  digest: string,
  signal?: AbortSignal,
): Promise<SuiTransaction | null> {
  const { data } = await gqlRequest<{ transaction: TxQueryResult | null }>(
    network,
    TRANSACTION_QUERY,
    { digest },
    signal,
  )
  const tx = data.transaction
  if (tx == null) return null

  const result: SuiTransaction = {
    digest: tx.digest,
    sender: tx.sender,
    gasInput: null,
    // System kinds aren't BCS-decodable; carry the discriminator straight through.
    kind:
      tx.kind && tx.kind.__typename !== 'ProgrammableTransaction'
        ? { __typename: tx.kind.__typename as SystemTransactionKind }
        : null,
    effects: tx.effects,
  }

  if (tx.kind?.__typename !== 'ProgrammableTransaction') return result

  const v1 =
    typeof tx.transactionBcs === 'string' ? decodeTxData(tx.transactionBcs) : null
  const ptb = v1?.kind?.ProgrammableTransaction
  const gas = v1?.gasData

  if (gas) {
    result.gasInput = {
      gasSponsor: { address: gas.owner },
      gasPrice: gas.price,
      gasBudget: gas.budget,
      gasPayment: { nodes: gas.payment.map((p) => ({ address: p.objectId })) },
    }
  }

  // Two batched, session-cached follow-ups recover the enrichment the structured
  // query used to inline: every object input's Move type, and each *unique*
  // MoveCall's function signature (deduped, so a signature is fetched at most once
  // — within this PTB and across transactions).
  const objectIds = ptb ? collectObjectInputIds(ptb.inputs) : []
  const calls = ptb
    ? ptb.commands
        .filter(
          (c): c is Extract<BcsCommand, { $kind: 'MoveCall' }> =>
            c.$kind === 'MoveCall',
        )
        .map((c) => c.MoveCall)
    : []
  const [objTypes, sigs] = await Promise.all([
    objectIds.length
      ? fetchObjectTypes(network, objectIds, signal)
      : Promise.resolve(new Map<string, string | null>()),
    calls.length
      ? resolveFunctionSignatures(network, calls, signal)
      : Promise.resolve(new Map<string, MoveFunctionSignature | null>()),
  ])

  const pureTypes = ptb ? inferPureTypes(ptb.commands, sigs) : new Map<number, string>()
  // BCS carries the full input/command lists (no 50-item page cap), so these are
  // always complete.
  result.kind = {
    __typename: 'ProgrammableTransaction',
    inputs: {
      pageInfo: { hasNextPage: false },
      nodes: ptb ? buildInputs(ptb.inputs, objTypes, pureTypes) : [],
    },
    commands: {
      pageInfo: { hasNextPage: false },
      nodes: ptb ? buildCommands(ptb.commands, sigs) : [],
    },
  }
  return result
}

/* ── BCS-decoded transaction-definition shapes ──────────────────────────── */
// The slices of a decoded `bcs.TransactionData` we read. Enum members decode to
// `{ $kind: Variant, [Variant]: payload }`; u64s decode to strings, addresses to
// `0x`-padded hex, and `TypeTag`s to `pkg::module::Type` repr strings.

type BcsArgument =
  | { $kind: 'GasCoin' }
  | { $kind: 'Input'; Input: number }
  | { $kind: 'Result'; Result: number }
  | { $kind: 'NestedResult'; NestedResult: [number, number] }

interface BcsObjectRef {
  objectId: string
  version: string
  digest: string
}
interface BcsSharedRef {
  objectId: string
  initialSharedVersion: string
  mutable: boolean
}
type BcsObjectArg =
  | { $kind: 'ImmOrOwnedObject'; ImmOrOwnedObject: BcsObjectRef }
  | { $kind: 'SharedObject'; SharedObject: BcsSharedRef }
  | { $kind: 'Receiving'; Receiving: BcsObjectRef }

type BcsInput =
  | { $kind: 'Pure'; Pure: { bytes: string } }
  | { $kind: 'Object'; Object: BcsObjectArg }
  | { $kind: 'FundsWithdrawal'; FundsWithdrawal: { typeArg?: { Balance?: string } } }

interface BcsMoveCall {
  package: string
  module: string
  function: string
  typeArguments: string[]
  arguments: BcsArgument[]
}
type BcsCommand =
  | { $kind: 'MoveCall'; MoveCall: BcsMoveCall }
  | { $kind: 'TransferObjects'; TransferObjects: { objects: BcsArgument[]; address: BcsArgument } }
  | { $kind: 'SplitCoins'; SplitCoins: { coin: BcsArgument; amounts: BcsArgument[] } }
  | { $kind: 'MergeCoins'; MergeCoins: { destination: BcsArgument; sources: BcsArgument[] } }
  | { $kind: 'MakeMoveVec'; MakeMoveVec: { type: string | null; elements: BcsArgument[] } }
  | { $kind: 'Publish'; Publish: { modules: string[]; dependencies: string[] } }
  | {
      $kind: 'Upgrade'
      Upgrade: { modules: string[]; dependencies: string[]; package: string; ticket: BcsArgument }
    }

interface BcsTransactionDataV1 {
  sender: string
  gasData: { payment: BcsObjectRef[]; owner: string; price: string; budget: string }
  kind: { ProgrammableTransaction?: { inputs: BcsInput[]; commands: BcsCommand[] } }
}

/** Decode the transaction definition from base64 BCS; `null` if the SDK schema
 *  can't parse it (e.g. a system-transaction kind it doesn't model). */
function decodeTxData(transactionBcs: string): BcsTransactionDataV1 | null {
  try {
    const decoded = bcs.TransactionData.fromBase64(transactionBcs) as {
      V1?: BcsTransactionDataV1
    }
    return decoded.V1 ?? null
  } catch {
    return null
  }
}

/** Map a decoded BCS argument onto the existing `TxArgument` wiring shape. */
function toTxArgument(a: BcsArgument): TxArgument {
  switch (a.$kind) {
    case 'GasCoin':
      return { __typename: 'GasCoin' }
    case 'Input':
      return { __typename: 'Input', ix: a.Input }
    case 'Result':
      return { __typename: 'TxResult', cmd: a.Result, ix: null }
    case 'NestedResult':
      return { __typename: 'TxResult', cmd: a.NestedResult[0], ix: a.NestedResult[1] }
  }
}

/** The unique object ids referenced by object inputs (for batched type lookup). */
function collectObjectInputIds(inputs: BcsInput[]): string[] {
  const ids: string[] = []
  for (const inp of inputs) {
    if (inp.$kind !== 'Object') continue
    const o = inp.Object
    ids.push(
      o.$kind === 'SharedObject'
        ? o.SharedObject.objectId
        : o.$kind === 'Receiving'
          ? o.Receiving.objectId
          : o.ImmOrOwnedObject.objectId,
    )
  }
  return [...new Set(ids)]
}

function objRefToInput(
  ref: BcsObjectRef,
  objTypes: Map<string, string | null>,
): InputObject {
  const type = objTypes.get(ref.objectId) ?? null
  return {
    address: ref.objectId,
    version: Number(ref.version),
    asMoveObject: type ? { contents: { type: { repr: type } } } : null,
  }
}

/** Build the typed `TxInput` list — object inputs gain their resolved Move type,
 *  pure inputs are decoded to a typed value where we can infer the type. */
function buildInputs(
  inputs: BcsInput[],
  objTypes: Map<string, string | null>,
  pureTypes: Map<number, string>,
): TxInput[] {
  return inputs.map((inp, i): TxInput => {
    if (inp.$kind === 'Pure') {
      const decoded = decodePure(pureTypes.get(i) ?? null, inp.Pure.bytes)
      return decoded
        ? { __typename: 'MoveValue', type: { repr: decoded.repr }, json: decoded.json }
        : { __typename: 'Pure', bytes: inp.Pure.bytes }
    }
    if (inp.$kind === 'FundsWithdrawal') {
      const repr = inp.FundsWithdrawal?.typeArg?.Balance ?? null
      return { __typename: 'BalanceWithdraw', type: repr ? { repr } : null }
    }
    const o = inp.Object
    if (o.$kind === 'SharedObject') {
      return {
        __typename: 'SharedInput',
        address: o.SharedObject.objectId,
        initialSharedVersion: Number(o.SharedObject.initialSharedVersion),
        mutable: o.SharedObject.mutable,
        type: objTypes.get(o.SharedObject.objectId) ?? null,
      }
    }
    if (o.$kind === 'Receiving') {
      return { __typename: 'Receiving', object: objRefToInput(o.Receiving, objTypes) }
    }
    return { __typename: 'OwnedOrImmutable', object: objRefToInput(o.ImmOrOwnedObject, objTypes) }
  })
}

/** Build the `TxCommand` list, attaching each MoveCall's resolved signature
 *  (a minimal target when the signature couldn't be fetched). */
function buildCommands(
  commands: BcsCommand[],
  sigs: Map<string, MoveFunctionSignature | null>,
): TxCommand[] {
  return commands.map((c): TxCommand => {
    switch (c.$kind) {
      case 'MoveCall': {
        const mc = c.MoveCall
        const sig = sigs.get(fnKey(mc.package, mc.module, mc.function))
        const fn: MoveFn = {
          name: mc.function,
          isEntry: sig?.isEntry ?? null,
          visibility: sig?.visibility ?? null,
          typeParameters: sig?.typeParameters ?? [],
          parameters: sig?.parameters ?? [],
          return: sig?.return ?? [],
          module: { package: { address: mc.package }, name: mc.module },
        }
        return {
          __typename: 'MoveCallCommand',
          function: fn,
          arguments: mc.arguments.map(toTxArgument),
          typeArguments: mc.typeArguments.slice(),
        }
      }
      case 'TransferObjects':
        return {
          __typename: 'TransferObjectsCommand',
          inputs: c.TransferObjects.objects.map(toTxArgument),
          address: toTxArgument(c.TransferObjects.address),
        }
      case 'SplitCoins':
        return {
          __typename: 'SplitCoinsCommand',
          coin: toTxArgument(c.SplitCoins.coin),
          amounts: c.SplitCoins.amounts.map(toTxArgument),
        }
      case 'MergeCoins':
        return {
          __typename: 'MergeCoinsCommand',
          coin: toTxArgument(c.MergeCoins.destination),
          coins: c.MergeCoins.sources.map(toTxArgument),
        }
      case 'MakeMoveVec':
        return {
          __typename: 'MakeMoveVecCommand',
          type: c.MakeMoveVec.type ? { repr: c.MakeMoveVec.type } : null,
          elements: c.MakeMoveVec.elements.map(toTxArgument),
        }
      case 'Publish':
        return {
          __typename: 'PublishCommand',
          modules: c.Publish.modules,
          dependencies: c.Publish.dependencies,
        }
      case 'Upgrade':
        return {
          __typename: 'UpgradeCommand',
          modules: c.Upgrade.modules,
          dependencies: c.Upgrade.dependencies,
          currentPackage: c.Upgrade.package,
          upgradeTicket: toTxArgument(c.Upgrade.ticket),
        }
    }
  })
}

/* ── pure-value decoding ─────────────────────────────────────────────────── */

/** Strip a leading reference marker (pures are never references — defensive). */
function stripRef(repr: string): string {
  return repr.replace(/^&mut\s+/, '').replace(/^&\s+/, '').trim()
}

/** A bcs decoder for a Move value, loosely typed since we only ever `.parse`. */
type ValueBcs = BcsType<unknown>
const loose = (t: unknown) => t as ValueBcs

/**
 * The bcs schema to decode a pure input of a given Move *value* type, or `null`
 * for a type we don't model (caller falls back to the raw bytes). Addresses /
 * object ids decode to `0x`-hex so the view can link them; numbers (u64+) decode
 * to strings; the rest map to their natural JSON.
 */
function bcsForValueType(repr: string): ValueBcs | null {
  const t = stripRef(repr)
  switch (t) {
    case 'bool':
      return loose(bcs.bool())
    case 'u8':
      return loose(bcs.u8())
    case 'u16':
      return loose(bcs.u16())
    case 'u32':
      return loose(bcs.u32())
    case 'u64':
      return loose(bcs.u64())
    case 'u128':
      return loose(bcs.u128())
    case 'u256':
      return loose(bcs.u256())
    case 'address':
      return loose(bcs.Address)
  }
  if (/^0x0*2::object::(ID|UID)$/.test(t)) return loose(bcs.Address)
  if (/^0x0*1::(string::String|ascii::String)$/.test(t)) return loose(bcs.string())
  const vec = /^vector<(.+)>$/.exec(t)
  if (vec) {
    const inner = bcsForValueType(vec[1])
    return inner ? loose(bcs.vector(inner)) : null
  }
  const opt = /^0x0*1::option::Option<(.+)>$/.exec(t)
  if (opt) {
    const inner = bcsForValueType(opt[1])
    return inner ? loose(bcs.option(inner)) : null
  }
  return null
}

/** Decode a pure input's bytes using its inferred Move value type → `{ repr,
 *  json }`, or `null` when the type is unknown or the bytes don't decode. */
function decodePure(
  repr: string | null,
  base64Bytes: string,
): { repr: string; json: unknown } | null {
  if (!repr) return null
  const schema = bcsForValueType(repr)
  if (!schema) return null
  try {
    return { repr, json: schema.parse(fromBase64(base64Bytes)) }
  } catch {
    return null
  }
}

/**
 * Infer each pure input's Move value type from where it's first used as an
 * argument: a MoveCall pairs `arguments[k]` with `parameters[k]` (the trailing
 * `&TxContext` is runtime-supplied, so the prefix lines up — see `MoveFn`);
 * split-coin amounts are `u64`, a transfer recipient is `address`, make-move-vec
 * elements take the vec's element type. Inputs with no inferable type stay raw.
 */
function inferPureTypes(
  commands: BcsCommand[],
  sigs: Map<string, MoveFunctionSignature | null>,
): Map<number, string> {
  const types = new Map<number, string>()
  const note = (arg: BcsArgument, repr: string | null | undefined) => {
    if (repr && arg.$kind === 'Input' && !types.has(arg.Input)) {
      types.set(arg.Input, stripRef(repr))
    }
  }
  for (const c of commands) {
    if (c.$kind === 'MoveCall') {
      const sig = sigs.get(fnKey(c.MoveCall.package, c.MoveCall.module, c.MoveCall.function))
      c.MoveCall.arguments.forEach((a, k) => note(a, sig?.parameters[k]?.repr))
    } else if (c.$kind === 'SplitCoins') {
      c.SplitCoins.amounts.forEach((a) => note(a, 'u64'))
    } else if (c.$kind === 'TransferObjects') {
      note(c.TransferObjects.address, 'address')
    } else if (c.$kind === 'MakeMoveVec' && c.MakeMoveVec.type) {
      c.MakeMoveVec.elements.forEach((a) => note(a, c.MakeMoveVec.type))
    }
  }
  return types
}

/* ── function-signature resolution (batched + session-cached) ────────────── */

function fnKey(pkg: string, module: string, fn: string): string {
  return `${pkg}::${module}::${fn}`
}

const FN_SIG_SELECTION =
  'name visibility isEntry typeParameters { constraints } parameters { repr } return { repr }'

/** Session cache of resolved signatures, keyed by `network|pkg::module::fn`. A
 *  signature never changes, so this dedups across every transaction in a session. */
const fnSigCache = new Map<string, Promise<MoveFunctionSignature | null>>()

interface FnRef {
  package: string
  module: string
  function: string
}

/** A single aliased signature lookup. Ids are inlined — the package is 0x-hex
 *  and module/function are Move identifiers (`[A-Za-z0-9_]`), so neither can
 *  break out of the string. */
function fnSigSelection(ref: FnRef, alias: string): string {
  return `${alias}: object(address: "${ref.package}") { asMovePackage { module(name: "${ref.module}") { function(name: "${ref.function}") { ${FN_SIG_SELECTION} } } } }`
}

// Sui GraphQL rejects a query over ~5000 bytes / 300 nodes. Each signature
// lookup is ~13 nodes, so with selections inlined the byte budget binds first —
// pack refs up to ~4000 bytes (and ≤20 for node headroom) per request.
const FN_SIG_QUERY_BUDGET = 4000
const FN_SIG_MAX_PER_QUERY = 20

/** Group refs into batches whose rendered query stays under the size caps. */
function chunkFnRefs(refs: FnRef[]): FnRef[][] {
  const batches: FnRef[][] = []
  let cur: FnRef[] = []
  let bytes = 0
  for (const ref of refs) {
    const size = fnSigSelection(ref, 'a00').length + 1
    if (cur.length > 0 && (bytes + size > FN_SIG_QUERY_BUDGET || cur.length >= FN_SIG_MAX_PER_QUERY)) {
      batches.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(ref)
    bytes += size
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

/** Fetch many function signatures, split into request-sized aliased queries run
 *  in parallel. */
async function batchFetchFnSigs(
  network: Network,
  refs: FnRef[],
  signal?: AbortSignal,
): Promise<Map<string, MoveFunctionSignature | null>> {
  const out = new Map<string, MoveFunctionSignature | null>()
  await Promise.all(
    chunkFnRefs(refs).map(async (chunk) => {
      const selections = chunk.map((ref, j) => fnSigSelection(ref, `a${j}`)).join('\n')
      const { data } = await gqlRequest<
        Record<
          string,
          { asMovePackage: { module: { function: MoveFunctionSignature | null } | null } | null } | null
        >
      >(network, `query FnSigs {\n${selections}\n}`, {}, signal)
      chunk.forEach((ref, j) => {
        out.set(
          fnKey(ref.package, ref.module, ref.function),
          data[`a${j}`]?.asMovePackage?.module?.function ?? null,
        )
      })
    }),
  )
  return out
}

/**
 * Resolve each unique MoveCall's signature, session-cached so a given signature
 * is fetched at most once. Cache misses go out in one batched query; a failed
 * lookup (e.g. an aborted request) is evicted so a later view can retry, and is
 * surfaced as `null` rather than failing the whole transaction.
 */
async function resolveFunctionSignatures(
  network: Network,
  calls: FnRef[],
  signal?: AbortSignal,
): Promise<Map<string, MoveFunctionSignature | null>> {
  const unique = new Map<string, FnRef>()
  for (const c of calls) unique.set(fnKey(c.package, c.module, c.function), c)

  const missing = [...unique].filter(([k]) => !fnSigCache.has(`${network}|${k}`))
  if (missing.length > 0) {
    const batch = batchFetchFnSigs(network, missing.map(([, c]) => c), signal)
    for (const [k] of missing) {
      const cacheKey = `${network}|${k}`
      const p = batch.then((m) => m.get(k) ?? null)
      fnSigCache.set(cacheKey, p)
      p.catch(() => fnSigCache.delete(cacheKey))
    }
  }

  const out = new Map<string, MoveFunctionSignature | null>()
  for (const [k] of unique) {
    try {
      out.set(k, (await fnSigCache.get(`${network}|${k}`)) ?? null)
    } catch {
      out.set(k, null)
    }
  }
  return out
}

const MODULE_DISASSEMBLY_QUERY = `
query ModuleDisassembly($package: SuiAddress!, $module: String!) {
  object(address: $package) {
    asMovePackage { module(name: $module) { disassembly } }
  }
}
`

/**
 * Fetch the disassembled body of one function. The GraphQL API only exposes
 * disassembly per-module, so we fetch the module and slice out the named
 * function's top-level block. `null` when the package/module/function isn't
 * found or has no disassembly (e.g. a native function with no body).
 */
export async function fetchFunctionDisassembly(
  network: Network,
  packageId: string,
  module: string,
  fnName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { data } = await gqlRequest<{
    object: {
      asMovePackage: { module: { disassembly: string | null } | null } | null
    } | null
  }>(network, MODULE_DISASSEMBLY_QUERY, { package: packageId, module }, signal)

  const disassembly = data.object?.asMovePackage?.module?.disassembly
  if (!disassembly) return null
  return extractFunctionDisassembly(disassembly, fnName)
}

/**
 * Slice one function's block out of a module disassembly. Functions are
 * top-level (column-0) blocks: `… <name>(<…>)(args): ret {` … closed by a `}`
 * at column 0. Returns `null` if the function isn't found or has no body.
 */
function extractFunctionDisassembly(disassembly: string, name: string): string | null {
  const lines = disassembly.split('\n')
  const decl = new RegExp(`\\b${escapeRegExp(name)}\\s*(?:<[^>]*>)?\\s*\\(`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!/^\s/.test(l) && l.includes('{') && decl.test(l)) {
      start = i
      break
    }
  }
  if (start === -1) return null
  let end = lines.length - 1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') {
      end = i
      break
    }
  }
  return lines.slice(start, end + 1).join('\n')
}

/**
 * Whether a pure input's Move type is an address / object id (or a `vector` of
 * them) — i.e. its decoded value is one or more on-chain ids worth linking.
 * Returns the arity so the view knows to expect a scalar string or an array;
 * `null` for anything else (numbers, bools, `vector<u8>` byte blobs, …).
 */
export function addressLikeArity(typeRepr: string): 'scalar' | 'vector' | null {
  const t = typeRepr.trim()
  const vec = t.match(/^vector<(.+)>$/)
  if (vec) return isAddressLikeScalar(vec[1].trim()) ? 'vector' : null
  return isAddressLikeScalar(t) ? 'scalar' : null
}

/** `address`, or the framework `0x2::object::{ID,UID}` (full-form repr). */
function isAddressLikeScalar(t: string): boolean {
  return t === 'address' || /^0x0*2::object::(ID|UID)$/.test(t)
}

/** The Move type repr backing an input, when one is known. */
export function inputType(input: TxInput): string | null {
  switch (input.__typename) {
    case 'MoveValue':
    case 'BalanceWithdraw':
      return input.type?.repr ?? null
    case 'OwnedOrImmutable':
    case 'Receiving':
      return input.object.asMoveObject?.contents?.type.repr ?? null
    case 'SharedInput':
      return input.type ?? null
    case 'Pure':
      return null
  }
}

/** CamelCase / PascalCase → snake_case (`PersonalKioskCap` → `personal_kiosk_cap`;
 * all-caps tokens collapse: `SUI` → `sui`, `USDC` → `usdc`). */
export function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * A variable name derived from a type repr — snake_case of its top-level struct
 * (`…::PersonalKioskCap` → `personal_kiosk_cap`). `Coin<T>` and `Balance<T>` are
 * special-cased to `coin_<sym>` / `balance_<sym>`, where `<sym>` is the inner
 * coin type's name (`0x2::sui::SUI` → `sui`, `…::usdc::USDC` → `usdc`). Null when
 * the repr isn't a struct (a primitive, `vector`, …).
 */
export function typeVarName(repr: string | null): string | null {
  if (!repr) return null
  const t = repr.trim()
  const coinLike = /^0x0*2::(coin::Coin|balance::Balance)<(.+)>$/.exec(t)
  if (coinLike) {
    const kind = coinLike[1].endsWith('Coin') ? 'coin' : 'balance'
    const innerStruct = coinLike[2].split('<', 1)[0].split('::').pop() ?? ''
    return /^[A-Za-z]/.test(innerStruct) ? `${kind}_${snakeCase(innerStruct)}` : kind
  }
  const struct = t.split('<', 1)[0].split('::').pop() ?? ''
  if (!/^[A-Za-z]/.test(struct)) return null
  return snakeCase(struct)
}

/** The Move type of an *object* input (Owned/Shared/Receiving) — the only inputs
 * we name. Pure values, decoded `MoveValue`s, and balance withdraws aren't named
 * (they read better as their literal value), so they return null. */
export function namedInputType(input: TxInput): string | null {
  switch (input.__typename) {
    case 'OwnedOrImmutable':
    case 'Receiving':
      return input.object.asMoveObject?.contents?.type.repr ?? null
    case 'SharedInput':
      return input.type ?? null
    default:
      return null
  }
}

/** Every argument a command references, flattened in source order. */
export function commandArguments(cmd: TxCommand): TxArgument[] {
  switch (cmd.__typename) {
    case 'MoveCallCommand':
      return cmd.arguments
    case 'SplitCoinsCommand':
      return [cmd.coin, ...cmd.amounts]
    case 'MergeCoinsCommand':
      return [cmd.coin, ...cmd.coins]
    case 'TransferObjectsCommand':
      return [...cmd.inputs, cmd.address]
    case 'MakeMoveVecCommand':
      return cmd.elements
    case 'PublishCommand':
      return []
    case 'UpgradeCommand':
      return [cmd.upgradeTicket]
  }
}

/**
 * The set of command indices whose result is consumed by a later command —
 * i.e. which `resN` bindings are actually referenced. Shared by the program
 * renderers (SDK / CLI / script) so they bind `resN` only when needed.
 */
export function usedResults(commands: TxCommand[]): Set<number> {
  const used = new Set<number>()
  for (const cmd of commands) {
    for (const a of commandArguments(cmd)) {
      if (a.__typename === 'TxResult') used.add(a.cmd)
    }
  }
  return used
}

/**
 * The 0-based index of the command a failed PTB aborted in, parsed from the
 * execution-error message (the schema has no dedicated field). Sui phrases it as
 * a 1-based ordinal — e.g. `"Error in 10th command, … abort code: 0"` → 9.
 * `null` when the message is absent or doesn't name a command.
 */
export function failedCommandIndex(
  message: string | null | undefined,
): number | null {
  if (!message) return null
  const m = /\b(\d+)(?:st|nd|rd|th) command\b/i.exec(message)
  if (!m) return null
  const ordinal = Number(m[1])
  return ordinal >= 1 ? ordinal - 1 : null
}

/** The bytecode instruction offset an abort names (`… (instruction 57) …`) — the
 * offset within the failed function, matching the disassembly's `\t57:` line —
 * or null when the message doesn't carry one. */
export function failedInstructionOffset(
  message: string | null | undefined,
): number | null {
  if (!message) return null
  const m = /\binstruction (\d+)\b/i.exec(message)
  return m ? Number(m[1]) : null
}

/* ── transaction lists (by sender / affected object / affected address) ── */

// Paginated from the *end* (`last`/`before`) so the newest transactions come
// first — the connection's natural order is ascending (oldest first) and has no
// `orderBy` argument, so walking backward from the tail is how you get
// newest-first. Within a `last` window nodes are still ascending, so the caller
// reverses them; `hasPreviousPage`/`startCursor` drive the "older" page.
const TX_LIST_QUERY = `
query TxList($filter: TransactionFilter, $last: Int, $before: String) {
  transactions(last: $last, before: $before, filter: $filter) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      digest
      kind { __typename }
      sender { address }
      effects {
        status
        timestamp
        gasEffects { gasSummary { computationCost storageCost storageRebate } }
      }
    }
  }
}
`

/** A transaction filter — pick exactly one relation (the schema allows more). */
export type TxFilter =
  | { sentAddress: string }
  | { affectedObject: string }
  | { affectedAddress: string }
  /** A package id, `pkg::module`, or `pkg::module::function` — txs that call it. */
  | { function: string }
  /** Transactions sealed in a given checkpoint, by sequence number. */
  | { atCheckpoint: number }

export interface TxListItem {
  digest: string
  kind: string | null
  sender: string | null
  status: string | null
  timestamp: string | null
  /** Net gas used (computation + storage − rebate, in MIST); null if unknown. */
  gas: bigint | null
}

interface TxListResult {
  transactions: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
    nodes: {
      digest: string
      kind: { __typename: string } | null
      sender: { address: string } | null
      effects: {
        status: string | null
        timestamp: string | null
        gasEffects: { gasSummary: GasSummary | null } | null
      } | null
    }[]
  }
}

/**
 * One page of transactions matching a filter — `sentAddress` for txs an address
 * signed, `affectedObject` for txs that touched an object, `affectedAddress` for
 * any tx involving an address. Lightweight per-row summary (digest, kind,
 * sender, status, time); `first` is capped at 50 by the service.
 *
 * Results come newest-first (the `Page` is paged backward in time — its
 * `endCursor` walks to the next, older page). `limit` is capped at 50 by the
 * service.
 */
export async function fetchTransactions(
  network: Network,
  filter: TxFilter,
  args: PageArgs,
  signal?: AbortSignal,
): Promise<Page<TxListItem>> {
  const { data } = await gqlRequest<TxListResult>(
    network,
    TX_LIST_QUERY,
    { filter, last: args.limit, before: args.cursor ?? null },
    signal,
  )
  return mapBackwardPage(data.transactions, (n) => ({
    digest: n.digest,
    kind: n.kind?.__typename ?? null,
    sender: n.sender?.address ?? null,
    status: n.effects?.status ?? null,
    timestamp: n.effects?.timestamp ?? null,
    gas: netGasUsed(n.effects?.gasEffects?.gasSummary),
  }))
}

/* ───────────────────────────── signer scheme ───────────────────────────── */

// A Sui address carries no on-chain marker for *how* it signs — it's just a
// hash. The only evidence is a transaction the address authored: the signature
// reveals the scheme (Ed25519, Secp256k1/r1, multisig, zkLogin, passkey) and
// whatever that scheme exposes — a public key, a multisig committee, a zkLogin
// proof epoch, a passkey origin. So we read it from a tx this address *sent*.
// `sentAddress` guarantees the address is the sender, and Sui orders a tx's
// signatures sender-first (sponsor, if any, second) — so `signatures[0]` is
// always this address's own signature.
//
// Notably absent: the zkLogin *issuer* (OIDC provider). `publicIdentifier`,
// `jwkId`, and `inputs.issBase64Details` all come back null/empty from this
// endpoint, so `maxEpoch` is the only zkLogin datum available.
const SIGNER_SCHEME_QUERY = `
query SignerScheme($address: SuiAddress!) {
  transactions(last: 5, filter: { sentAddress: $address }) {
    nodes {
      signatures {
        scheme {
          __typename
          ... on Ed25519Signature { publicKey }
          ... on Secp256K1Signature { publicKey }
          ... on Secp256R1Signature { publicKey }
          ... on ZkLoginSignature { maxEpoch }
          ... on PasskeySignature {
            clientDataJson
            signature {
              __typename
              ... on Secp256R1Signature { publicKey }
              ... on Secp256K1Signature { publicKey }
            }
          }
          ... on MultisigSignature {
            bitmap
            committee {
              threshold
              members {
                weight
                publicKey {
                  __typename
                  ... on Ed25519PublicKey { bytes }
                  ... on Secp256K1PublicKey { bytes }
                  ... on Secp256R1PublicKey { bytes }
                  ... on PasskeyPublicKey { bytes }
                  ... on ZkLoginPublicIdentifier { iss }
                }
              }
            }
          }
        }
      }
    }
  }
}
`

/** GraphQL `SignatureScheme` union member → friendly scheme name. */
const SCHEME_NAMES: Record<string, string> = {
  Ed25519Signature: 'Ed25519',
  Secp256K1Signature: 'Secp256k1',
  Secp256R1Signature: 'Secp256r1',
  MultisigSignature: 'multisig',
  ZkLoginSignature: 'zkLogin',
  PasskeySignature: 'passkey',
}

/** GraphQL `MultisigMemberPublicKey` union member → friendly scheme name. */
const PUBKEY_SCHEME_NAMES: Record<string, string> = {
  Ed25519PublicKey: 'Ed25519',
  Secp256K1PublicKey: 'Secp256k1',
  Secp256R1PublicKey: 'Secp256r1',
  PasskeyPublicKey: 'passkey',
  ZkLoginPublicIdentifier: 'zkLogin',
}

export interface MultisigMember {
  /** Signing scheme of this member's key (e.g. `Ed25519`). */
  scheme: string
  /** Base64 public-key bytes, or the issuer URL for a zkLogin member; null if
   * the schema returned an unrecognised key shape. */
  publicKey: string | null
  /** This member's vote weight toward the threshold. */
  weight: number
}

export interface MultisigInfo {
  /** Combined weight required to authorise a transaction (M of N). */
  threshold: number
  members: MultisigMember[]
}

export interface SignerScheme {
  /** Friendly name of the scheme the address signs with (e.g. `Ed25519`). */
  scheme: string
  /** Base64 public key — present for single-key schemes (Ed25519/Secp256k1/
   * Secp256r1) and the inner key of a passkey. Null for zkLogin/multisig. */
  publicKey: string | null
  /** Multisig committee — present only for a multisig scheme. */
  multisig: MultisigInfo | null
  /** zkLogin: last epoch the ephemeral proof is valid for. Null unless zkLogin. */
  maxEpoch: number | null
  /** Passkey: the WebAuthn relying-party origin (from `clientDataJson`). */
  passkeyOrigin: string | null
}

interface SchemeNode {
  __typename: string
  /** Single-key schemes: the Base64 public key. */
  publicKey?: string
  /** zkLogin. */
  maxEpoch?: number
  /** Passkey: WebAuthn client-data JSON + the inner (r1/k1) signature. */
  clientDataJson?: string
  signature?: { __typename: string; publicKey?: string } | null
  /** Multisig. */
  committee?: {
    threshold: number
    members: {
      weight: number
      publicKey: { __typename: string; bytes?: string; iss?: string } | null
    }[]
  } | null
}

interface SignerSchemeResult {
  transactions: {
    nodes: { signatures: { scheme: SchemeNode }[] | null }[]
  } | null
}

/** Pull the relying-party `origin` out of a passkey's WebAuthn client data. */
function parsePasskeyOrigin(clientDataJson?: string): string | null {
  if (!clientDataJson) return null
  try {
    const origin = (JSON.parse(clientDataJson) as { origin?: unknown }).origin
    return typeof origin === 'string' ? origin : null
  } catch {
    return null
  }
}

/**
 * Determine how an address signs by inspecting a transaction it authored, and
 * surface everything that scheme exposes (public key, multisig committee,
 * zkLogin proof epoch, passkey origin). Returns `null` when the address has
 * never sent a transaction — Sui exposes no other signal, so a receive-only
 * address is indistinguishable from a single-key account.
 */
export async function fetchSignerScheme(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<SignerScheme | null> {
  const { data } = await gqlRequest<SignerSchemeResult>(
    network,
    SIGNER_SCHEME_QUERY,
    { address },
    signal,
  )
  // Nodes come oldest→newest; walk from the newest and use the first tx that
  // actually carries a signature (`signatures[0]` is the sender's — see query).
  const nodes = data.transactions?.nodes ?? []
  for (let i = nodes.length - 1; i >= 0; i--) {
    const s = nodes[i].signatures?.[0]?.scheme
    if (!s) continue
    const scheme = SCHEME_NAMES[s.__typename] ?? s.__typename
    const base: SignerScheme = {
      scheme,
      publicKey: null,
      multisig: null,
      maxEpoch: null,
      passkeyOrigin: null,
    }
    switch (s.__typename) {
      case 'MultisigSignature':
        return {
          ...base,
          multisig: s.committee
            ? {
                threshold: s.committee.threshold,
                members: s.committee.members.map((m) => ({
                  scheme: PUBKEY_SCHEME_NAMES[m.publicKey?.__typename ?? ''] ?? '?',
                  publicKey: m.publicKey?.bytes ?? m.publicKey?.iss ?? null,
                  weight: m.weight,
                })),
              }
            : null,
        }
      case 'ZkLoginSignature':
        return { ...base, maxEpoch: s.maxEpoch ?? null }
      case 'PasskeySignature':
        return {
          ...base,
          publicKey: s.signature?.publicKey ?? null,
          passkeyOrigin: parsePasskeyOrigin(s.clientDataJson),
        }
      default:
        // Ed25519 / Secp256k1 / Secp256r1 — single key.
        return { ...base, publicKey: s.publicKey ?? null }
    }
  }
  return null
}
