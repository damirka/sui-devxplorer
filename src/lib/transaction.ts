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
import { fetchObjectTypes } from './object'
import { mapBackwardPage, type Page, type PageArgs } from './pagination'
import type { MoveFunctionSignature } from './move'
import type { Network } from '@/context/network-context'

const TRANSACTION_QUERY = `
query Transaction($digest: String!) {
  transaction(digest: $digest) {
    digest
    # Fully-resolved JSON form of the tx. The structured \`commands\` path below
    # has no \`typeArguments\` on a MoveCall, but this does — we read the concrete
    # call type args from here and attach them by command index (see fetch).
    transactionJson
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

/** Fetch a transaction by digest. `transaction` is `null` when not found. */
export async function fetchTransaction(
  network: Network,
  digest: string,
  signal?: AbortSignal,
): Promise<SuiTransaction | null> {
  const { data } = await gqlRequest<{
    transaction: (SuiTransaction & { transactionJson?: unknown }) | null
  }>(network, TRANSACTION_QUERY, { digest }, signal)

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

    // MoveCall type arguments aren't in the structured schema — graft them on
    // from `transactionJson` by command index (the two command lists are
    // parallel; `commands` may be truncated at 50, but it's a prefix so indices
    // still line up).
    const byCmd = commandTypeArguments(tx?.transactionJson)
    kind.commands.nodes.forEach((cmd, i) => {
      if (cmd.__typename === 'MoveCallCommand') cmd.typeArguments = byCmd[i] ?? []
    })
  }
  return tx
}

/**
 * Per-command MoveCall type arguments parsed out of `transactionJson`
 * (`kind.programmableTransaction.commands[i].moveCall.typeArguments`). Returns a
 * positional array aligned with the command list — `[]` for non-MoveCall
 * positions and when the field/JSON is absent. Treated as plain data: the
 * strings are rendered as type reprs only, never interpreted.
 */
function commandTypeArguments(transactionJson: unknown): string[][] {
  const commands = (
    transactionJson as
      | { kind?: { programmableTransaction?: { commands?: unknown } } }
      | null
      | undefined
  )?.kind?.programmableTransaction?.commands
  if (!Array.isArray(commands)) return []
  return commands.map((c) => {
    const ta = (c as { moveCall?: { typeArguments?: unknown } } | null)?.moveCall
      ?.typeArguments
    return Array.isArray(ta) ? ta.filter((t): t is string => typeof t === 'string') : []
  })
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

interface TxListResult {
  transactions: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
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
