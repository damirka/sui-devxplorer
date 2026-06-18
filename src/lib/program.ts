/**
 * Program serialization: render a transaction's programmable block to the three
 * copy formats the Program panel offers — a compact pseudo-Move `script`, valid
 * `@mysten/sui` TypeScript SDK code, and a `sui client ptb` CLI command. All
 * three share the type-argument unification and pure-value decoding helpers
 * below. Data shapes come from `./transaction`.
 */
import { bcs } from '@mysten/sui/bcs'
import { formatType } from './format'
import {
  usedResults,
  typeVarName,
  namedInputType,
  type TxArgument,
  type TxCommand,
  type TxInput,
} from './transaction'

/** Variable names for a PTB's object inputs and command results. */
export interface ProgramNames {
  /** Object-input index → name (`coin_sui`, `kiosk`, …). */
  inputs: Map<number, string>
  /** Command index → its result binding's name. */
  results: Map<number, string>
}

/**
 * Name a PTB's object inputs and command results from their types — snake_case
 * of each one's struct (`coin_sui`, `kiosk`, …; see `typeVarName`), numbered when
 * a name recurs. Inputs and results share one namespace so no two bindings
 * collide; a result whose return type can't be resolved falls back to `resN`.
 */
export function programVarNames(
  commands: TxCommand[],
  inputs: TxInput[],
): ProgramNames {
  const inferredPure = inferPureTypes(commands, inputs)
  const resolved = resolveTypeArguments(commands, inputs, inferredPure)
  const used = usedResults(commands)

  const inputBase = new Map<number, string>()
  inputs.forEach((inp, i) => {
    const name = typeVarName(namedInputType(inp))
    if (name) inputBase.set(i, name)
  })
  const resultBase = new Map<number, string>()
  commands.forEach((cmd, i) => {
    if (!used.has(i)) return
    const name = typeVarName(
      resultType(cmd, i, inputs, inferredPure, commands, resolved),
    )
    // `res_` prefix marks it as a command result (vs an input), matching the
    // `resN` fallback for results whose type doesn't resolve.
    if (name) resultBase.set(i, `res_${name}`)
  })

  // Number any base used more than once across inputs *and* results.
  const counts = new Map<string, number>()
  for (const n of [...inputBase.values(), ...resultBase.values()]) {
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const numbered = (base: string) => {
    if ((counts.get(base) ?? 0) <= 1) return base
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return `${base}${n}`
  }
  const names: ProgramNames = { inputs: new Map(), results: new Map() }
  inputBase.forEach((base, i) => names.inputs.set(i, numbered(base)))
  resultBase.forEach((base, i) => names.results.set(i, numbered(base)))
  return names
}

/** The type a command's whole result carries — `return[0]` for a MoveCall, the
 * coin type for a split, the fixed types for publish/upgrade — or null. */
function resultType(
  cmd: TxCommand,
  i: number,
  inputs: TxInput[],
  inferredPure: Map<number, string>,
  commands: TxCommand[],
  resolved: Map<number, string[]>,
): string | null {
  if (cmd.__typename === 'SplitCoinsCommand') {
    return concreteArgType(cmd.coin, inputs, inferredPure, commands, resolved)
  }
  return concreteArgType(
    { __typename: 'TxResult', cmd: i, ix: null },
    inputs,
    inferredPure,
    commands,
    resolved,
  )
}

/** A result reference for the script / SDK forms (`name` or `name[ix]`). */
function resultText(names: ProgramNames, cmd: number, ix: number | null): string {
  const name = names.results.get(cmd) ?? `res${cmd}`
  return ix == null ? name : `${name}[${ix}]`
}

/**
 * Render the programmable block as compact pseudo-Move script, inlining each
 * input's literal value at its argument position (object ids, decoded pure
 * values, gas, and `resN` result references) — the copy form of the readable
 * "script" view.
 */
export function programToText(commands: TxCommand[], inputs: TxInput[]): string {
  const inferredPure = inferPureTypes(commands, inputs)
  const typeArgsByCmd = resolveTypeArguments(commands, inputs, inferredPure)
  const used = usedResults(commands)
  const names = programVarNames(commands, inputs)
  // Declare each named (object) input up front so the statements read by name;
  // pure values stay inlined at their argument position.
  const decls = inputs.flatMap((inp, i) => {
    const name = names.inputs.get(i)
    return name ? [`${name} = ${objectAddr(inp)};`] : []
  })
  const stmts = commands.map(
    (cmd, i) =>
      `${used.has(i) ? `${resultText(names, i, null)} = ` : ''}${callText(cmd, inputs, names, typeArgsByCmd.get(i))};`,
  )
  return [...decls, ...(decls.length ? [''] : []), ...stmts].join('\n')
}

/** The on-chain id backing an object input — the value for its declaration. */
function objectAddr(inp: TxInput): string {
  switch (inp.__typename) {
    case 'OwnedOrImmutable':
    case 'Receiving':
      return inp.object.address
    case 'SharedInput':
      return inp.address
    default:
      return ''
  }
}

function callText(
  cmd: TxCommand,
  inputs: TxInput[],
  names: ProgramNames,
  typeArgs?: string[],
): string {
  const list = (args: TxArgument[]) =>
    args.map((a) => argText(a, inputs, names)).join(', ')
  switch (cmd.__typename) {
    case 'MoveCallCommand': {
      const fn = cmd.function
      const target = fn
        ? `${fn.module.package.address}::${fn.module.name}::${fn.name}`
        : 'unknown_function'
      const ta = typeArgs && typeArgs.length ? `<${typeArgs.join(', ')}>` : ''
      return `${target}${ta}(${list(cmd.arguments)})`
    }
    case 'SplitCoinsCommand':
      return `split_coins(${argText(cmd.coin, inputs, names)}, [${list(cmd.amounts)}])`
    case 'MergeCoinsCommand':
      return `merge_coins(${argText(cmd.coin, inputs, names)}, [${list(cmd.coins)}])`
    case 'TransferObjectsCommand':
      return `transfer_objects([${list(cmd.inputs)}], ${argText(cmd.address, inputs, names)})`
    case 'MakeMoveVecCommand':
      return `make_move_vec${cmd.type ? `<${cmd.type.repr}>` : ''}([${list(cmd.elements)}])`
    case 'PublishCommand':
      return `publish(/* ${cmd.modules.length} module${cmd.modules.length === 1 ? '' : 's'}, ${cmd.dependencies.length} deps */)`
    case 'UpgradeCommand':
      return `upgrade(${cmd.currentPackage}, ${argText(cmd.upgradeTicket, inputs, names)})`
  }
}

function argText(
  arg: TxArgument,
  inputs: TxInput[],
  names: ProgramNames,
): string {
  switch (arg.__typename) {
    case 'GasCoin':
      return 'gas'
    case 'TxResult':
      return resultText(names, arg.cmd, arg.ix)
    case 'Input':
      return inputText(inputs[arg.ix], arg.ix, names.inputs)
  }
}

function inputText(
  input: TxInput | undefined,
  ix: number,
  inputNames: Map<number, string>,
): string {
  const name = inputNames.get(ix)
  if (name) return name
  if (!input) return `input${ix}`
  switch (input.__typename) {
    case 'Pure':
      return `0x${base64ToHex(input.bytes)}`
    case 'MoveValue':
      return moveValueText(input.json)
    case 'OwnedOrImmutable':
    case 'Receiving':
      return input.object.address
    case 'SharedInput':
      return input.address
    case 'BalanceWithdraw':
      return input.type ? `withdraw<${input.type.repr}>` : 'withdraw'
  }
}

/** A decoded pure value as code: ids/decimals bare, other strings quoted, arrays nested. */
function moveValueText(json: unknown): string {
  if (json == null) return 'null'
  if (typeof json === 'string') {
    if (/^0x[0-9a-fA-F]+$/.test(json) || /^\d+$/.test(json)) return json
    return JSON.stringify(json)
  }
  if (typeof json === 'boolean' || typeof json === 'number') return String(json)
  if (Array.isArray(json)) return `[${json.map(moveValueText).join(', ')}]`
  return JSON.stringify(json)
}

/**
 * Compose the programmable block as valid `@mysten/sui` TypeScript SDK code:
 * each input declared once (`tx.object(...)` / `tx.pure.<type>(...)` / gas),
 * each command as the matching builder call, result bindings (`const resN`)
 * only where consumed, and — crucially — `moveCall` `typeArguments` filled by
 * unifying the function's generic parameter types against the concrete types of
 * the arguments passed (see `resolveTypeArguments`).
 */
export function buildSdkProgram(commands: TxCommand[], inputs: TxInput[]): string {
  const inferredPure = inferPureTypes(commands, inputs)
  const typeArgsByCmd = resolveTypeArguments(commands, inputs, inferredPure)

  const used = usedResults(commands)
  const names = programVarNames(commands, inputs)

  const decls = inputs.map((inp, i) => {
    const varName = names.inputs.get(i) ?? `input${i}`
    const comment = inputComment(inp)
    return `const ${varName} = ${inputExpr(inp, inferredPure.get(i))};${
      comment ? ` // ${comment}` : ''
    }`
  })

  const stmts = commands.map(
    (cmd, i) =>
      `${used.has(i) ? `const ${resultText(names, i, null)} = ` : ''}${sdkCommand(cmd, names, typeArgsByCmd.get(i))};`,
  )

  return [
    'const tx = new Transaction();',
    ...(decls.length ? ['', ...decls] : []),
    '',
    ...stmts,
  ].join('\n')
}

const q = (s: string) => `'${s}'`

function sdkArg(arg: TxArgument, names: ProgramNames): string {
  switch (arg.__typename) {
    case 'GasCoin':
      return 'tx.gas'
    case 'TxResult':
      return resultText(names, arg.cmd, arg.ix)
    case 'Input':
      return names.inputs.get(arg.ix) ?? `input${arg.ix}`
  }
}

function sdkCommand(
  cmd: TxCommand,
  names: ProgramNames,
  typeArgs?: string[],
): string {
  const list = (args: TxArgument[]) => args.map((a) => sdkArg(a, names)).join(', ')
  switch (cmd.__typename) {
    case 'MoveCallCommand': {
      const fn = cmd.function
      const target = fn
        ? `${fn.module.package.address}::${fn.module.name}::${fn.name}`
        : '/* unknown */'
      const lines = ['tx.moveCall({', `  target: '${target}',`]
      if (typeArgs && typeArgs.length) {
        lines.push(`  typeArguments: [${typeArgs.map(q).join(', ')}],`)
      }
      if (cmd.arguments.length) {
        lines.push(`  arguments: [${list(cmd.arguments)}],`)
      }
      lines.push('})')
      return lines.join('\n')
    }
    case 'SplitCoinsCommand':
      return `tx.splitCoins(${sdkArg(cmd.coin, names)}, [${list(cmd.amounts)}])`
    case 'MergeCoinsCommand':
      return `tx.mergeCoins(${sdkArg(cmd.coin, names)}, [${list(cmd.coins)}])`
    case 'TransferObjectsCommand':
      return `tx.transferObjects([${list(cmd.inputs)}], ${sdkArg(cmd.address, names)})`
    case 'MakeMoveVecCommand':
      return `tx.makeMoveVec({ ${cmd.type ? `type: '${cmd.type.repr}', ` : ''}elements: [${list(cmd.elements)}] })`
    case 'PublishCommand':
      return [
        'tx.publish({',
        `  modules: [${cmd.modules.map(q).join(', ')}],`,
        `  dependencies: [${cmd.dependencies.map(q).join(', ')}],`,
        '})',
      ].join('\n')
    case 'UpgradeCommand':
      return [
        'tx.upgrade({',
        `  modules: [${cmd.modules.map(q).join(', ')}],`,
        `  dependencies: [${cmd.dependencies.map(q).join(', ')}],`,
        `  package: ${q(cmd.currentPackage)},`,
        `  ticket: ${sdkArg(cmd.upgradeTicket, names)},`,
        '})',
      ].join('\n')
  }
}

/** The SDK expression that creates an input — object ref, pure value, or gas. */
function inputExpr(inp: TxInput, inferredPure: string | undefined): string {
  switch (inp.__typename) {
    case 'OwnedOrImmutable':
    case 'Receiving':
      return objectExpr(inp.object.address)
    case 'SharedInput':
      return objectExpr(inp.address)
    case 'MoveValue':
      return pureExpr(inp.type.repr, inp.json)
    case 'Pure':
      return rawPureExpr(inp.bytes, inferredPure)
    case 'BalanceWithdraw':
      return inp.type ? `tx.object(/* withdraw ${inp.type.repr} */)` : 'tx.gas'
  }
}

/** A trailing comment with the object's concrete type (hidden by `tx.object`). */
function inputComment(inp: TxInput): string | null {
  switch (inp.__typename) {
    case 'OwnedOrImmutable':
    case 'Receiving': {
      const t = inp.object.asMoveObject?.contents?.type.repr
      return t ? formatType(t) : null
    }
    case 'SharedInput':
      return inp.type ? formatType(inp.type) : null
    default:
      return null
  }
}

function objectExpr(address: string): string {
  return wellKnownObject(address) ?? `tx.object('${address}')`
}

/** Framework singletons get their dedicated SDK helper. */
function wellKnownObject(address: string): string | null {
  const id = address.replace(/^0x/, '').replace(/^0+/, '') || '0'
  switch (id) {
    case '6':
      return 'tx.object.clock()'
    case '5':
      return 'tx.object.system()'
    case '8':
      return 'tx.object.random()'
    case '403':
      return 'tx.object.denyList()'
    default:
      return null
  }
}

/** A decoded pure value as a `tx.pure.<type>(...)` call. */
function pureExpr(typeRepr: string, json: unknown): string {
  const t = typeRepr.trim()
  switch (t) {
    case 'u8':
    case 'u16':
    case 'u32':
      return `tx.pure.${t}(${json})`
    case 'u64':
    case 'u128':
    case 'u256':
      return `tx.pure.${t}('${json}')`
    case 'bool':
      return `tx.pure.bool(${json})`
    case 'address':
      return `tx.pure.address('${json}')`
  }
  if (isIdType(t)) return `tx.pure.id('${json}')`
  if (isStringType(t)) return `tx.pure.string(${JSON.stringify(json)})`
  const vec = t.match(/^vector<(.+)>$/)
  if (vec) return vectorExpr(vec[1].trim(), json)
  const opt = t.match(/::option::Option<(.+)>$/)
  if (opt) {
    return `tx.pure.option('${pureName(opt[1].trim())}', ${json == null ? 'null' : JSON.stringify(json)})`
  }
  return `tx.pure(/* ${t} */ ${JSON.stringify(json)})`
}

function vectorExpr(innerRepr: string, json: unknown): string {
  const name = pureName(innerRepr)
  if (name === 'u8') {
    const bytes =
      typeof json === 'string'
        ? Array.from(base64ToBytes(json))
        : Array.isArray(json)
          ? json
          : []
    return `tx.pure.vector('u8', [${bytes.join(', ')}])`
  }
  return `tx.pure.vector('${name}', ${JSON.stringify(json)})`
}

/** A raw `Pure` input (bytes only): decode via BCS using the type inferred from
 * the function signature, falling back to a hex comment when type is unknown. */
function rawPureExpr(base64: string, inferred: string | undefined): string {
  if (inferred) {
    const value = decodePure(inferred, base64)
    if (value !== undefined) return pureExpr(inferred, value)
  }
  return `tx.pure(/* raw: 0x${base64ToHex(base64)} */)`
}

function decodePure(typeRepr: string, base64: string): unknown {
  const bytes = base64ToBytes(base64)
  const t = typeRepr.trim()
  try {
    switch (t) {
      case 'u8':
        return bcs.U8.parse(bytes)
      case 'u16':
        return bcs.U16.parse(bytes)
      case 'u32':
        return bcs.U32.parse(bytes)
      case 'u64':
        return bcs.U64.parse(bytes)
      case 'u128':
        return bcs.U128.parse(bytes)
      case 'u256':
        return bcs.U256.parse(bytes)
      case 'bool':
        return bcs.Bool.parse(bytes)
      case 'address':
        return bcs.Address.parse(bytes)
    }
    if (isIdType(t)) return bcs.Address.parse(bytes)
    if (isStringType(t)) return bcs.String.parse(bytes)
    const vec = t.match(/^vector<(.+)>$/)
    if (vec && vec[1].trim() === 'u8') return Array.from(bcs.vector(bcs.U8).parse(bytes))
  } catch {
    return undefined
  }
  return undefined
}

/** Map a Move type repr to the SDK's `PureTypeName` (for vector/option elements). */
function pureName(repr: string): string {
  const t = repr.trim()
  if (['u8', 'u16', 'u32', 'u64', 'u128', 'u256', 'bool', 'address'].includes(t)) {
    return t
  }
  if (isIdType(t)) return 'id'
  if (isStringType(t)) return 'string'
  const v = t.match(/^vector<(.+)>$/)
  if (v) return `vector<${pureName(v[1].trim())}>`
  const o = t.match(/::option::Option<(.+)>$/)
  if (o) return `option<${pureName(o[1].trim())}>`
  return t
}

function isIdType(t: string): boolean {
  return /::object::(ID|UID)$/.test(t)
}

function isStringType(t: string): boolean {
  return /::(string|ascii)::String$/.test(t)
}

/**
 * Resolve each MoveCall's `typeArguments` to `cmdIndex → [concrete type per type
 * param]`. The authoritative values come from `transactionJson` and are attached
 * to the command (`cmd.typeArguments`) at fetch time — those win. The inference
 * below (unifying the function's positional type vars `$0`/`$1` against the
 * concrete types of the arguments passed) is kept only as a fallback for when
 * the authoritative list is missing.
 */
function resolveTypeArguments(
  commands: TxCommand[],
  inputs: TxInput[],
  inferredPure: Map<number, string>,
): Map<number, string[]> {
  const resolved = new Map<number, string[]>()
  commands.forEach((cmd, i) => {
    if (cmd.__typename !== 'MoveCallCommand') return
    // Authoritative type args from transactionJson — exact, and available even
    // when the function definition didn't resolve. Use them directly.
    if (cmd.typeArguments.length) {
      resolved.set(i, cmd.typeArguments)
      return
    }
    // Fallback: infer from the signature (needs the resolved function).
    if (!cmd.function) return
    const arity = cmd.function.typeParameters.length
    if (arity === 0) return
    const out: (string | undefined)[] = new Array(arity).fill(undefined)
    cmd.arguments.forEach((arg, j) => {
      const param = cmd.function!.parameters[j]
      if (!param) return
      const concrete = concreteArgType(arg, inputs, inferredPure, commands, resolved)
      if (concrete) unifyTypeVars(param.repr, concrete, out)
    })
    resolved.set(
      i,
      out.map((t) => t ?? '/* type arg unresolved */'),
    )
  })
  return resolved
}

/** The concrete Move type repr an argument carries, if known. */
function concreteArgType(
  arg: TxArgument,
  inputs: TxInput[],
  inferredPure: Map<number, string>,
  commands: TxCommand[],
  resolved: Map<number, string[]>,
): string | null {
  switch (arg.__typename) {
    case 'GasCoin':
      return '0x2::coin::Coin<0x2::sui::SUI>'
    case 'Input': {
      const inp = inputs[arg.ix]
      if (!inp) return null
      switch (inp.__typename) {
        case 'OwnedOrImmutable':
        case 'Receiving':
          return inp.object.asMoveObject?.contents?.type.repr ?? null
        case 'SharedInput':
          return inp.type ?? null
        case 'MoveValue':
          return inp.type.repr
        case 'Pure':
          return inferredPure.get(arg.ix) ?? null
        case 'BalanceWithdraw':
          return inp.type?.repr ?? null
      }
      return null
    }
    case 'TxResult': {
      const producer = commands[arg.cmd]
      if (!producer) return null
      // Publish/Upgrade have fixed result types (no function to read).
      if (producer.__typename === 'PublishCommand') return PUBLISH_RESULT_TYPE
      if (producer.__typename === 'UpgradeCommand') return UPGRADE_RESULT_TYPE
      if (producer.__typename !== 'MoveCallCommand' || !producer.function) return null
      const ret =
        arg.ix == null ? producer.function.return[0] : producer.function.return[arg.ix]
      if (!ret) return null
      const targs = resolved.get(arg.cmd)
      return targs ? substituteTypeVars(ret.repr, targs) : ret.repr
    }
  }
}

/** A `Publish` command always yields `0x2::package::UpgradeCap`. */
export const PUBLISH_RESULT_TYPE = '0x2::package::UpgradeCap'
/** An `Upgrade` command yields `0x2::package::UpgradeReceipt`. */
export const UPGRADE_RESULT_TYPE = '0x2::package::UpgradeReceipt'

/** Bind positional type vars in `pattern` (e.g. `Pool<$0,$1>`) from `concrete`. */
function unifyTypeVars(
  pattern: string,
  concrete: string,
  out: (string | undefined)[],
): void {
  const pat = stripRef(pattern).trim()
  const v = pat.match(/^\$(\d+)$/)
  if (v) {
    const idx = Number(v[1])
    if (out[idx] === undefined) out[idx] = stripRef(concrete).trim()
    return
  }
  const p = parseGeneric(pat)
  const c = parseGeneric(stripRef(concrete).trim())
  if (p.args.length > 0 && p.args.length === c.args.length) {
    for (let i = 0; i < p.args.length; i++) unifyTypeVars(p.args[i], c.args[i], out)
  }
}

function substituteTypeVars(repr: string, targs: string[]): string {
  return repr.replace(/\$(\d+)/g, (_, n) => targs[Number(n)] ?? `$${n}`)
}

function stripRef(s: string): string {
  return s.replace(/^&mut\s+/, '').replace(/^&\s*/, '')
}

/** Split a Move type repr into its head and top-level generic arguments. */
function parseGeneric(s: string): { head: string; args: string[] } {
  const lt = s.indexOf('<')
  if (lt === -1) return { head: s, args: [] }
  const head = s.slice(0, lt)
  const inner = s.slice(lt + 1, s.lastIndexOf('>'))
  return { head, args: splitTopLevel(inner) }
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '<') depth++
    else if (ch === '>') depth--
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(last, i))
      last = i + 1
    }
  }
  out.push(s.slice(last))
  return out.map((x) => x.trim()).filter(Boolean)
}

/**
 * Infer the pure type of each raw `Pure` input from where it's used: a MoveCall
 * parameter type, a split amount (`u64`), a transfer recipient (`address`), or
 * a `makeMoveVec` element type. Used to BCS-decode raw bytes into a value.
 */
function inferPureTypes(
  commands: TxCommand[],
  inputs: TxInput[],
): Map<number, string> {
  const types = new Map<number, string>()
  const note = (arg: TxArgument, type: string) => {
    if (arg.__typename === 'Input' && inputs[arg.ix]?.__typename === 'Pure' && !types.has(arg.ix)) {
      types.set(arg.ix, stripRef(type).trim())
    }
  }
  for (const cmd of commands) {
    switch (cmd.__typename) {
      case 'MoveCallCommand':
        if (cmd.function) {
          cmd.arguments.forEach((a, j) => {
            const p = cmd.function!.parameters[j]
            if (p) note(a, p.repr)
          })
        }
        break
      case 'SplitCoinsCommand':
        cmd.amounts.forEach((a) => note(a, 'u64'))
        break
      case 'TransferObjectsCommand':
        note(cmd.address, 'address')
        break
      case 'MakeMoveVecCommand':
        if (cmd.type) cmd.elements.forEach((a) => note(a, cmd.type!.repr))
        break
    }
  }
  return types
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function base64ToHex(b64: string): string {
  try {
    let hex = ''
    for (const byte of base64ToBytes(b64)) hex += byte.toString(16).padStart(2, '0')
    return hex
  } catch {
    return b64
  }
}

/**
 * Compose the programmable block as a `sui client ptb` CLI invocation: one flag
 * per command in order, results bound with `--assign resN` (only when consumed),
 * objects/addresses as `@0x…`, gas as `gas`, pure values as bare literals, and
 * `--move-call` type args filled in `<…>` (recovered like the SDK builder). The
 * CLI infers pure types from the function signature, so no type wrappers needed.
 */
export function buildCliProgram(commands: TxCommand[], inputs: TxInput[]): string {
  const inferredPure = inferPureTypes(commands, inputs)
  const typeArgsByCmd = resolveTypeArguments(commands, inputs, inferredPure)
  const used = usedResults(commands)
  const names = programVarNames(commands, inputs)

  const flags: string[] = []
  commands.forEach((cmd, i) => {
    flags.push(cliCommand(cmd, typeArgsByCmd.get(i), inputs, inferredPure, names))
    if (used.has(i)) flags.push(`--assign ${names.results.get(i) ?? `res${i}`}`)
  })

  return ['sui client ptb', ...flags.map((f) => `  ${f}`)].join(' \\\n')
}

/** Quote a CLI token when it contains shell-significant characters. */
function shellToken(s: string): string {
  return /[\s[\]<>(),]/.test(s) ? `'${s}'` : s
}

function cliCommand(
  cmd: TxCommand,
  typeArgs: string[] | undefined,
  inputs: TxInput[],
  inferredPure: Map<number, string>,
  names: ProgramNames,
): string {
  const a = (arg: TxArgument) => cliArg(arg, inputs, inferredPure, names)
  const arr = (args: TxArgument[]) => shellToken(`[${args.map(a).join(', ')}]`)
  switch (cmd.__typename) {
    case 'MoveCallCommand': {
      const fn = cmd.function
      const target = fn
        ? `${fn.module.package.address}::${fn.module.name}::${fn.name}`
        : 'UNKNOWN'
      const parts = ['--move-call', target]
      if (typeArgs && typeArgs.length) parts.push(shellToken(`<${typeArgs.join(',')}>`))
      cmd.arguments.forEach((arg) => parts.push(shellToken(a(arg))))
      return parts.join(' ')
    }
    case 'SplitCoinsCommand':
      return `--split-coins ${shellToken(a(cmd.coin))} ${arr(cmd.amounts)}`
    case 'MergeCoinsCommand':
      return `--merge-coins ${shellToken(a(cmd.coin))} ${arr(cmd.coins)}`
    case 'TransferObjectsCommand':
      return `--transfer-objects ${arr(cmd.inputs)} ${shellToken(a(cmd.address))}`
    case 'MakeMoveVecCommand':
      return `--make-move-vec ${shellToken(`<${cmd.type ? cmd.type.repr : '?'}>`)} ${arr(cmd.elements)}`
    case 'PublishCommand':
      return '--publish <path/to/package>'
    case 'UpgradeCommand':
      return `--upgrade <path/to/package> # ${cmd.currentPackage}`
  }
}

function cliArg(
  arg: TxArgument,
  inputs: TxInput[],
  inferredPure: Map<number, string>,
  names: ProgramNames,
): string {
  switch (arg.__typename) {
    case 'GasCoin':
      return 'gas'
    case 'TxResult': {
      const n = names.results.get(arg.cmd) ?? `res${arg.cmd}`
      return arg.ix == null ? n : `${n}.${arg.ix}`
    }
    case 'Input':
      return cliInput(inputs[arg.ix], inferredPure.get(arg.ix))
  }
}

function cliInput(inp: TxInput | undefined, inferred: string | undefined): string {
  if (!inp) return 'UNKNOWN'
  switch (inp.__typename) {
    case 'OwnedOrImmutable':
    case 'Receiving':
      return `@${inp.object.address}`
    case 'SharedInput':
      return `@${inp.address}`
    case 'MoveValue':
      return cliValue(inp.type.repr, inp.json)
    case 'Pure': {
      if (inferred) {
        const v = decodePure(inferred, inp.bytes)
        if (v !== undefined) return cliValue(inferred, v)
      }
      return `0x${base64ToHex(inp.bytes)}`
    }
    case 'BalanceWithdraw':
      return 'gas'
  }
}

/** A pure value as a CLI literal: addresses/ids `@0x…`, vectors `[a, b]`, rest bare. */
function cliValue(typeRepr: string, json: unknown): string {
  const t = typeRepr.trim()
  if (t === 'address' || isIdType(t)) return `@${json}`
  if (t === 'bool') return String(json)
  if (['u8', 'u16', 'u32', 'u64', 'u128', 'u256'].includes(t)) return String(json)
  if (isStringType(t)) return typeof json === 'string' ? JSON.stringify(json) : String(json)
  const vec = t.match(/^vector<(.+)>$/)
  if (vec) {
    const inner = vec[1].trim()
    let items: string[]
    if (inner === 'u8' && typeof json === 'string') {
      items = Array.from(base64ToBytes(json)).map(String)
    } else if (Array.isArray(json)) {
      items = json.map((v) => cliValue(inner, v))
    } else {
      items = []
    }
    return `[${items.join(', ')}]`
  }
  return String(json)
}
