/**
 * Transaction fetching over Sui GraphQL. One query gets the overview (sender,
 * gas, status, timing), the programmable-transaction block (typed inputs and
 * the command pipeline with decoded argument wiring), and the effects (object
 * changes, balance changes, events). Shapes mirror the schema's unions exactly
 * — see the inline fragments on `TransactionKind`, `TransactionInput`,
 * `Command`, and `TransactionArgument`.
 */
import { gqlRequest } from './graphql'
import { escapeRegExp } from './format'
import type { Network } from '@/context/network-context'

const TRANSACTION_QUERY = `
query Transaction($digest: String!) {
  transaction(digest: $digest) {
    digest
    sender { address }
    gasInput {
      gasSponsor { address }
      gasPrice
      gasBudget
      gasPayment(first: 10) { nodes { address } }
    }
    kind {
      __typename
      ... on ProgrammableTransaction {
        inputs(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on Pure { bytes }
            ... on MoveValue { type { repr } json }
            ... on OwnedOrImmutable { object { ...InputObjectFields } }
            ... on SharedInput { address initialSharedVersion mutable }
            ... on Receiving { object { ...InputObjectFields } }
            ... on BalanceWithdraw { type { repr } }
          }
        }
        commands(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on MoveCallCommand {
              function {
                module { package { address } name }
                name
                isEntry
                visibility
                typeParameters { constraints }
                parameters { repr }
                return { repr }
              }
              arguments { ...ArgFields }
            }
            ... on SplitCoinsCommand {
              coin { ...ArgFields }
              amounts { ...ArgFields }
            }
            ... on TransferObjectsCommand {
              inputs { ...ArgFields }
              address { ...ArgFields }
            }
            ... on MergeCoinsCommand {
              coin { ...ArgFields }
              coins { ...ArgFields }
            }
            ... on MakeMoveVecCommand {
              type { repr }
              elements { ...ArgFields }
            }
            ... on PublishCommand { modules dependencies }
            ... on UpgradeCommand {
              modules
              dependencies
              currentPackage
              upgradeTicket { ...ArgFields }
            }
          }
        }
      }
    }
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

fragment ArgFields on TransactionArgument {
  __typename
  ... on Input { ix }
  ... on TxResult { cmd ix }
  ... on GasCoin { _ }
}

fragment InputObjectFields on Object {
  address
  version
  asMoveObject { contents { type { repr } } }
}
`

const OBJECT_TYPES_QUERY = `
query ObjectTypes($keys: [ObjectKey!]!) {
  multiGetObjects(keys: $keys) {
    address
    asMoveObject { contents { type { repr } } }
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
      /** Resolved out-of-band via `multiGetObjects` — shared inputs don't expose it. */
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

export interface MoveFn {
  module: { package: { address: string }; name: string }
  name: string
  isEntry: boolean | null
  visibility: 'PUBLIC' | 'PRIVATE' | 'FRIEND' | null
  /** Type parameters in declaration order; positional in reprs as `$0`, `$1`, … */
  typeParameters: { constraints: string[] }[]
  /**
   * Parameter types in declaration order. A trailing `&TxContext` is part of
   * the signature but supplied by the runtime, so `arguments` has one fewer
   * entry — pair `arguments[i]` with `parameters[i]` and treat the remainder
   * as runtime-provided.
   */
  parameters: { repr: string }[]
  return: { repr: string }[]
}

export type TxCommand =
  | { __typename: 'MoveCallCommand'; function: MoveFn | null; arguments: TxArgument[] }
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

export interface GasSummary {
  computationCost: string | null
  storageCost: string | null
  storageRebate: string | null
  nonRefundableStorageFee: string | null
}

export interface ObjectChangeNode {
  address: string
  idCreated: boolean | null
  idDeleted: boolean | null
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

/** Fetch a transaction by digest. `transaction` is `null` when not found. */
export async function fetchTransaction(
  network: Network,
  digest: string,
  signal?: AbortSignal,
): Promise<SuiTransaction | null> {
  const { data } = await gqlRequest<{ transaction: SuiTransaction | null }>(
    network,
    TRANSACTION_QUERY,
    { digest },
    signal,
  )

  // Owned/Receiving inputs carry their Move type already; shared inputs don't
  // expose the object, so resolve those types in one batched follow-up query.
  const tx = data.transaction
  const kind = tx?.kind
  if (kind?.__typename === 'ProgrammableTransaction') {
    const shared = kind.inputs.nodes.filter(
      (n): n is Extract<TxInput, { __typename: 'SharedInput' }> =>
        n.__typename === 'SharedInput',
    )
    if (shared.length > 0) {
      const types = await fetchObjectTypes(
        network,
        shared.map((s) => s.address),
        signal,
      )
      for (const s of shared) s.type = types.get(s.address) ?? null
    }
  }
  return tx
}

/** Resolve `address → Move type repr` for a set of object ids in one query. */
async function fetchObjectTypes(
  network: Network,
  addresses: string[],
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const keys = addresses.map((address) => ({ address }))
  const { data } = await gqlRequest<{
    multiGetObjects: {
      address: string
      asMoveObject: { contents: { type: { repr: string } } | null } | null
    }[]
  }>(network, OBJECT_TYPES_QUERY, { keys }, signal)

  const map = new Map<string, string | null>()
  for (const o of data.multiGetObjects ?? []) {
    map.set(o.address, o.asMoveObject?.contents?.type.repr ?? null)
  }
  return map
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

/** Net gas used = computation + storage − rebate (in MIST). `null` if unknown. */
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

/* ── transaction lists (by sender / affected object / affected address) ── */

const TX_LIST_QUERY = `
query TxList($filter: TransactionFilter, $first: Int, $after: String) {
  transactions(first: $first, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      digest
      kind { __typename }
      sender { address }
      effects { status timestamp }
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

export interface TxListItem {
  digest: string
  kind: string | null
  sender: string | null
  status: string | null
  timestamp: string | null
}

export interface TxListPage {
  transactions: TxListItem[]
  hasNextPage: boolean
  endCursor: string | null
}

interface TxListResult {
  transactions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: {
      digest: string
      kind: { __typename: string } | null
      sender: { address: string } | null
      effects: { status: string | null; timestamp: string | null } | null
    }[]
  }
}

/**
 * One page of transactions matching a filter — `sentAddress` for txs an address
 * signed, `affectedObject` for txs that touched an object, `affectedAddress` for
 * any tx involving an address. Lightweight per-row summary (digest, kind,
 * sender, status, time); `first` is capped at 50 by the service.
 */
export async function fetchTransactions(
  network: Network,
  filter: TxFilter,
  opts: { first: number; after?: string | null },
  signal?: AbortSignal,
): Promise<TxListPage> {
  const { data } = await gqlRequest<TxListResult>(
    network,
    TX_LIST_QUERY,
    { filter, first: opts.first, after: opts.after ?? null },
    signal,
  )
  const conn = data.transactions
  return {
    transactions: conn.nodes.map((n) => ({
      digest: n.digest,
      kind: n.kind?.__typename ?? null,
      sender: n.sender?.address ?? null,
      status: n.effects?.status ?? null,
      timestamp: n.effects?.timestamp ?? null,
    })),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}
