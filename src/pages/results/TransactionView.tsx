import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkedHash, TypeLink, useSearchHref } from '@/components/ui/links'
import { JsonBlock, linkifyAddresses } from '@/components/ui/JsonBlock'
import { HoverCard } from '@/components/ui/HoverCard'
import { CopyButton } from '@/components/ui/CopyButton'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { DANGER_PRE } from '@/components/ui/codeBlock'
import { cn } from '@/lib/cn'
import { truncateMiddle } from '@/lib/search'
import { formatSui, formatTimestamp, formatType, formatSignatureType } from '@/lib/format'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchTransaction,
  fetchFunctionDisassembly,
  usedResults,
  netGasUsed,
  inputType,
  addressLikeArity,
  type SuiTransaction,
  type TxInput,
  type TxCommand,
  type TxArgument,
  type MoveFn,
} from '@/lib/transaction'
import {
  buildSdkProgram,
  buildCliProgram,
  programToText,
  PUBLISH_RESULT_TYPE,
  UPGRADE_RESULT_TYPE,
} from '@/lib/program'
import { ResultHeader } from './ResultHeader'

/**
 * Transaction view — the flagship devx surface. Live over GraphQL: the
 * programmable-transaction inputs, the command pipeline with decoded argument
 * wiring, and the resulting effects (object/balance changes, events).
 */
export function TransactionView({ value }: { value: string }) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => fetchTransaction(network, value, signal),
    [network, value],
  )

  return (
    <div>
      <ResultHeader
        kind="transaction"
        label="Transaction"
        value={value}
        meta={data?.effects?.status ? <StatusPill status={data.effects.status} /> : undefined}
      />

      {loading && (
        <Panel>
          <PanelSection>
            <SkeletonLines count={6} />
          </PanelSection>
        </Panel>
      )}

      {error && (
        <EmptyState title="failed to load transaction">{error.message}</EmptyState>
      )}

      {!loading && !error && data === null && (
        <EmptyState title="transaction not found">
          no transaction exists with this digest on the selected network.
        </EmptyState>
      )}

      {data && <TransactionBody tx={data} />}
    </div>
  )
}

function TransactionBody({ tx }: { tx: SuiTransaction }) {
  const fx = tx.effects
  const gas = tx.gasInput
  const kind = tx.kind
  const ptb = kind?.__typename === 'ProgrammableTransaction' ? kind : null
  const used = netGasUsed(fx?.gasEffects?.gasSummary)
  const [inputsOpen, setInputsOpen] = useState(false)

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection>
          <FieldGrid cols={3}>
            <Field label="Status">
              {fx?.status ? <StatusPill status={fx.status} /> : <Muted>—</Muted>}
            </Field>
            <Field label="Sender">
              {tx.sender ? <LinkedHash value={tx.sender.address} /> : <Muted>—</Muted>}
            </Field>
          </FieldGrid>

          <div className="border-line mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 font-mono text-xs sm:grid-cols-4">
            <GasStat
              label="gas used"
              value={used == null ? '—' : formatSui(used)}
            />
            <GasStat
              label="gas price"
              value={
                gas?.gasPrice
                  ? `${Number(gas.gasPrice).toLocaleString('en-US')} MIST`
                  : '—'
              }
            />
            <GasStat
              label="gas owner"
              value={
                gas?.gasSponsor ? (
                  <LinkedHash value={gas.gasSponsor.address} />
                ) : (
                  '—'
                )
              }
            />
          </div>

          {gas && (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs sm:grid-cols-4">
              <GasStat label="budget" value={formatSui(gas.gasBudget)} />
              <GasStat
                label="computation"
                value={formatSui(fx?.gasEffects?.gasSummary?.computationCost)}
              />
              <GasStat
                label="storage"
                value={formatSui(fx?.gasEffects?.gasSummary?.storageCost)}
              />
              <GasStat
                label="rebate"
                value={formatSui(fx?.gasEffects?.gasSummary?.storageRebate)}
              />
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs sm:grid-cols-4">
            <GasStat label="timestamp" value={formatTimestamp(fx?.timestamp)} />
            <GasStat
              label="checkpoint"
              value={fx?.checkpoint?.sequenceNumber?.toLocaleString('en-US') ?? '—'}
            />
            <GasStat label="epoch" value={String(fx?.epoch?.epochId ?? '—')} />
          </div>

          {fx?.executionError && (
            <div className="mt-5">
              <span className="text-danger font-mono text-[0.6875rem] tracking-wide lowercase">
                execution error
              </span>
              <pre className={DANGER_PRE}>
                <code>
                  {[
                    fx.executionError.identifier && `${fx.executionError.identifier}`,
                    fx.executionError.abortCode != null &&
                      `abort code ${fx.executionError.abortCode}`,
                    fx.executionError.message,
                  ]
                    .filter(Boolean)
                    .join('\n') || 'transaction failed'}
                </code>
              </pre>
            </div>
          )}
        </PanelSection>
      </Panel>

      {ptb ? (
        <>
          <ProgramPanel
            commands={ptb.commands.nodes}
            inputs={ptb.inputs.nodes}
            hasNextPage={ptb.commands.pageInfo.hasNextPage}
          />

          <Panel>
            <section className="p-5">
              <button
                type="button"
                onClick={() => setInputsOpen((o) => !o)}
                className="group flex w-full items-center justify-between"
              >
                <span className="panel-label">Inputs</span>
                <span className="text-muted group-hover:text-primary flex items-center gap-1.5 font-mono text-xs transition-colors">
                  {ptb.inputs.nodes.length}
                  {ptb.inputs.pageInfo.hasNextPage ? '+' : ''}
                  {inputsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </button>
              {inputsOpen &&
                (ptb.inputs.nodes.length > 0 ? (
                  <ol className="divide-line mt-3 divide-y font-mono text-xs">
                    {ptb.inputs.nodes.map((input, i) => (
                      <li key={i} className="flex gap-3 py-2.5">
                        <span className="text-secondary w-16 shrink-0">input{i}</span>
                        <div className="min-w-0 flex-1">
                          <InputValue input={input} />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3">
                    <Muted>no inputs.</Muted>
                  </p>
                ))}
            </section>
          </Panel>
        </>
      ) : (
        kind && (
          <Panel>
            <PanelSection label="Kind">
              <span className="font-mono text-sm">{kind.__typename}</span>
              <p className="text-muted mt-2 text-sm">
                a system transaction — no programmable block.
              </p>
            </PanelSection>
          </Panel>
        )
      )}

      {fx && (
        <Panel>
          <ObjectChanges fx={fx} />
          <BalanceChanges fx={fx} />
          <Events fx={fx} />
        </Panel>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: 'SUCCESS' | 'FAILURE' }) {
  const ok = status === 'SUCCESS'
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-xs ${
        ok ? 'border-secondary/40 text-secondary' : 'border-danger/40 text-danger'
      }`}
    >
      <span className={`size-1.5 ${ok ? 'bg-secondary' : 'bg-danger'}`} />
      {ok ? 'success' : 'failure'}
    </span>
  )
}

/**
 * Decode a single programmable-transaction input by its union variant. Every
 * input that carries a Move type shows its full type signature (resolved from
 * the referenced object for object inputs, including shared) on its own line.
 */
function InputValue({ input }: { input: TxInput }) {
  const type = inputType(input)

  const header = (() => {
    switch (input.__typename) {
      case 'Pure':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>pure</Tag>
            <span className="text-muted break-all">{input.bytes}</span>
          </span>
        )
      case 'MoveValue':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>pure</Tag>
            <PureValue typeRepr={input.type.repr} json={input.json} />
          </span>
        )
      case 'OwnedOrImmutable':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>object</Tag>
            <LinkedHash value={input.object.address} />
            {input.object.version != null && (
              <span className="text-muted">v{input.object.version}</span>
            )}
          </span>
        )
      case 'SharedInput':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>shared</Tag>
            <LinkedHash value={input.address} />
            <span className="text-muted">
              v{input.initialSharedVersion} · {input.mutable ? 'mutable' : 'read-only'}
            </span>
          </span>
        )
      case 'Receiving':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>receiving</Tag>
            <LinkedHash value={input.object.address} />
            {input.object.version != null && (
              <span className="text-muted">v{input.object.version}</span>
            )}
          </span>
        )
      case 'BalanceWithdraw':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Tag>withdraw</Tag>
          </span>
        )
    }
  })()

  return (
    <span className="flex flex-col gap-1">
      {header}
      {type && (
        <span className="min-w-0">
          <TypeLink type={type} />
        </span>
      )}
    </span>
  )
}

/**
 * A pure input's decoded value. When the Move type is an address / object id
 * (or a `vector` of them), each id renders as a clickable, copyable link;
 * everything else stays plain JSON text.
 */
function PureValue({ typeRepr, json }: { typeRepr: string; json: unknown }) {
  const arity = addressLikeArity(typeRepr)

  if (arity === 'scalar' && isHexId(json)) {
    return <LinkedHash value={json} />
  }

  if (arity === 'vector' && Array.isArray(json)) {
    const ids = json.filter(isHexId)
    if (ids.length === json.length && ids.length > 0) {
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {ids.map((id, i) => (
            <span key={i} className="flex items-center">
              <LinkedHash value={id} />
              {i < ids.length - 1 && <span className="text-muted">,</span>}
            </span>
          ))}
        </span>
      )
    }
  }

  return <span className="text-text break-all">{formatJson(json)}</span>
}

function isHexId(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)
}

/**
 * The programmable block rendered as a readable script: one statement per
 * command, results bound to `resN` when a later command consumes them, and
 * every argument referenced by name (`inputN`, `resN`, `gas`). Hovering a name
 * reveals its type, value, and links — so the structure reads end to end
 * without cross-referencing the inputs list.
 */
/**
 * The programmable block rendered as valid `@mysten/sui` TS SDK code (see
 * `buildSdkProgram`): inputs declared as `tx.object(...)` / `tx.pure.<type>(...)`,
 * each command as its builder call with filled `typeArguments`, results bound to
 * `resN`. Object ids are linkified so they stay clickable.
 */
/**
 * The Program panel: a tabbed view of the programmable block. The "script" tab
 * (default) is the readable pseudo-Move script with hover cards; the "ts sdk"
 * tab is valid `@mysten/sui` code. The copy button copies whichever is active.
 */
function ProgramPanel({
  commands,
  inputs,
  hasNextPage,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
  hasNextPage: boolean
}) {
  const [tab, setTab] = useState<'script' | 'sdk' | 'cli'>('script')
  const empty = commands.length === 0
  const copyValue =
    tab === 'sdk'
      ? buildSdkProgram(commands, inputs)
      : tab === 'cli'
        ? buildCliProgram(commands, inputs)
        : programToText(commands, inputs)
  const copyLabel =
    tab === 'sdk' ? 'Copy as TS SDK' : tab === 'cli' ? 'Copy CLI command' : 'Copy script'

  return (
    <Panel>
      <PanelSection
        label="Program"
        action={
          <div className="flex items-center gap-3">
            <span className="text-muted font-mono text-xs">
              {commands.length} command{commands.length === 1 ? '' : 's'}
              {hasNextPage ? '+' : ''}
            </span>
            {!empty && (
              <CopyButton
                value={copyValue}
                label={copyLabel}
                className="text-muted hover:text-primary"
              />
            )}
          </div>
        }
      >
        {empty ? (
          <Muted>no commands.</Muted>
        ) : (
          <>
            <div className="border-line mb-4 flex gap-1 border-b">
              <TabButton active={tab === 'script'} onClick={() => setTab('script')}>
                script
              </TabButton>
              <TabButton active={tab === 'sdk'} onClick={() => setTab('sdk')}>
                ts sdk
              </TabButton>
              <TabButton active={tab === 'cli'} onClick={() => setTab('cli')}>
                sui cli
              </TabButton>
            </div>
            {tab === 'script' ? (
              <CommandScript commands={commands} inputs={inputs} />
            ) : tab === 'sdk' ? (
              <SdkProgram commands={commands} inputs={inputs} />
            ) : (
              <CliProgram commands={commands} inputs={inputs} />
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-2.5 py-1 font-mono text-xs lowercase transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The programmable block rendered as a readable script: one statement per
 * command, results bound to `resN` when a later command consumes them, and
 * every argument referenced by name (`inputN`, `resN`, `gas`). Hovering a name
 * reveals its type, value, and links — so the structure reads end to end
 * without cross-referencing the inputs list.
 */
function CommandScript({
  commands,
  inputs,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
}) {
  const used = usedResults(commands)

  return (
    <div className="bg-bg/60 border-line space-y-1 border p-4 font-mono text-xs leading-6">
      {commands.map((cmd, i) => (
        <CommandStatement
          key={i}
          index={i}
          cmd={cmd}
          inputs={inputs}
          commands={commands}
          assigned={used.has(i)}
        />
      ))}
    </div>
  )
}

function CommandStatement({
  index,
  cmd,
  inputs,
  commands,
  assigned,
}: {
  index: number
  cmd: TxCommand
  inputs: TxInput[]
  commands: TxCommand[]
  assigned: boolean
}) {
  return (
    <div className="break-words whitespace-pre-wrap">
      {assigned && (
        <>
          <span className="text-muted">let </span>
          <ResultToken cmd={index} ix={null} commands={commands} />
          <span className="text-muted"> = </span>
        </>
      )}
      <CallExpr cmd={cmd} inputs={inputs} commands={commands} />
      <span className="text-muted">;</span>
      {cmd.__typename === 'MoveCallCommand' && cmd.function && (
        <MoveCallAsm fn={cmd.function} />
      )}
    </div>
  )
}

/** A lazy, toggleable disassembly of a MoveCall's function body. */
function MoveCallAsm({ fn }: { fn: MoveFn }) {
  const { network } = useNetwork()
  const [open, setOpen] = useState(false)
  const { data, loading, error } = useAsync(
    (signal) =>
      open
        ? fetchFunctionDisassembly(
            network,
            fn.module.package.address,
            fn.module.name,
            fn.name,
            signal,
          )
        : Promise.resolve(null),
    [network, open, fn.module.package.address, fn.module.name, fn.name],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-primary ml-2 inline-flex items-center gap-1 align-baseline text-[0.6875rem] transition-colors"
        title="disassembled function body"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        asm
      </button>
      {open && (
        <div className="mt-1.5">
          {loading && <SkeletonLines count={4} />}
          {error && (
            <span className="text-danger text-xs">failed to load disassembly.</span>
          )}
          {!loading && !error && data == null && (
            <span className="text-muted text-xs">
              no disassembly available for this function.
            </span>
          )}
          {data && (
            <pre className="bg-bg border-line text-muted overflow-x-auto border p-3 text-[0.6875rem] leading-5">
              <code>{data}</code>
            </pre>
          )}
        </div>
      )}
    </>
  )
}

/** The call expression for one command, in pseudo-Move-call form. */
function CallExpr({
  cmd,
  inputs,
  commands,
}: {
  cmd: TxCommand
  inputs: TxInput[]
  commands: TxCommand[]
}) {
  const seq = (list: TxArgument[]) => (
    <ArgSeq args={list} inputs={inputs} commands={commands} />
  )
  switch (cmd.__typename) {
    case 'MoveCallCommand':
      return (
        <>
          <FnTarget fn={cmd.function} />({seq(cmd.arguments)})
        </>
      )
    case 'SplitCoinsCommand':
      return (
        <>
          <Builtin name="split_coins" />({seq([cmd.coin])}, [{seq(cmd.amounts)}])
        </>
      )
    case 'MergeCoinsCommand':
      return (
        <>
          <Builtin name="merge_coins" />({seq([cmd.coin])}, [{seq(cmd.coins)}])
        </>
      )
    case 'TransferObjectsCommand':
      return (
        <>
          <Builtin name="transfer_objects" />([{seq(cmd.inputs)}], {seq([cmd.address])})
        </>
      )
    case 'MakeMoveVecCommand':
      return (
        <>
          <Builtin name="make_move_vec" />
          {cmd.type && (
            <span className="text-secondary" title={cmd.type.repr}>
              &lt;{formatSignatureType(cmd.type.repr)}&gt;
            </span>
          )}
          ([{seq(cmd.elements)}])
        </>
      )
    case 'PublishCommand':
      return (
        <>
          <Builtin name="publish" />(
          <span className="text-muted">/* {cmd.dependencies.length} deps */</span>)
        </>
      )
    case 'UpgradeCommand':
      return (
        <>
          <Builtin name="upgrade" />(<PkgLink address={cmd.currentPackage} />)
        </>
      )
  }
}

/** Comma-separated argument references. */
function ArgSeq({
  args,
  inputs,
  commands,
}: {
  args: TxArgument[]
  inputs: TxInput[]
  commands: TxCommand[]
}) {
  return (
    <>
      {args.map((a, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted">, </span>}
          <ArgToken arg={a} inputs={inputs} commands={commands} />
        </span>
      ))}
    </>
  )
}

/** A builtin (non-Move-call) command name. */
function Builtin({ name }: { name: string }) {
  return <span className="text-primary">{name}</span>
}

/** A MoveCall target: clickable package + module, function name reveals the signature. */
function FnTarget({ fn }: { fn: MoveFn | null }) {
  if (!fn) return <span className="text-danger">unknown_function</span>
  return (
    <span className="items-baseline">
      <PkgLink address={fn.module.package.address} />
      <span className="text-muted">::{fn.module.name}::</span>
      <HoverCard card={<SignatureCard fn={fn} />}>
        <span className="text-primary cursor-help underline decoration-dotted underline-offset-2">
          {fn.name}
        </span>
      </HoverCard>
    </span>
  )
}

/** A truncated, linked package address (no copy button — kept inline-light). */
function PkgLink({ address }: { address: string }) {
  const href = useSearchHref()
  return (
    <Link
      to={href(address)}
      title={address}
      className="text-text hover:text-primary hover:underline"
    >
      {truncateMiddle(address)}
    </Link>
  )
}

/** A reference to a command argument: `gas`, `resN`, or `inputN` — each with a hover card. */
function ArgToken({
  arg,
  inputs,
  commands,
}: {
  arg: TxArgument
  inputs: TxInput[]
  commands: TxCommand[]
}) {
  if (arg.__typename === 'GasCoin') {
    return (
      <HoverCard card={<span className="text-muted">the transaction&apos;s gas coin</span>}>
        <span className="text-muted cursor-help underline decoration-dotted underline-offset-2">
          gas
        </span>
      </HoverCard>
    )
  }
  if (arg.__typename === 'TxResult') {
    return <ResultToken cmd={arg.cmd} ix={arg.ix} commands={commands} />
  }
  const input = inputs[arg.ix]
  return (
    <HoverCard card={<InputCard ix={arg.ix} input={input} />}>
      <span className="text-secondary cursor-help underline decoration-dotted underline-offset-2">
        input{arg.ix}
      </span>
    </HoverCard>
  )
}

/** A reference to a prior command's result. */
function ResultToken({
  cmd,
  ix,
  commands,
}: {
  cmd: number
  ix: number | null
  commands: TxCommand[]
}) {
  const label = ix == null ? `res${cmd}` : `res${cmd}.${ix}`
  return (
    <HoverCard card={<ResultCard index={cmd} cmd={commands[cmd]} />}>
      <span className="text-primary cursor-help underline decoration-dotted underline-offset-2">
        {label}
      </span>
    </HoverCard>
  )
}

/** Hover card body for an input — its kind, value, and type (all links live). */
function InputCard({ ix, input }: { ix: number; input: TxInput | undefined }) {
  return (
    <div className="space-y-2">
      <div className="text-secondary">input{ix}</div>
      {input ? (
        <InputValue input={input} />
      ) : (
        <span className="text-muted">unknown input</span>
      )}
    </div>
  )
}

/** Hover card body for a result — which command produced it and its type. */
function ResultCard({ index, cmd }: { index: number; cmd: TxCommand | undefined }) {
  const ret =
    cmd?.__typename === 'PublishCommand'
      ? formatType(PUBLISH_RESULT_TYPE)
      : cmd?.__typename === 'UpgradeCommand'
        ? formatType(UPGRADE_RESULT_TYPE)
        : cmd?.__typename === 'MoveCallCommand' && cmd.function?.return.length
          ? cmd.function.return.map((r) => formatSignatureType(r.repr)).join(', ')
          : null
  return (
    <div className="space-y-1">
      <div className="text-primary">res{index}</div>
      {cmd ? (
        <div className="text-muted">
          result of command {index} · {commandKind(cmd)}
        </div>
      ) : (
        <span className="text-muted">unknown result</span>
      )}
      {ret && (
        <div>
          <span className="text-muted">type </span>
          <span className="text-secondary">{ret}</span>
        </div>
      )}
    </div>
  )
}

/** The full function signature, shown on hover over a MoveCall target. */
function SignatureCard({ fn }: { fn: MoveFn }) {
  const typeParams = fn.typeParameters
    .map((tp, i) => {
      const c = tp.constraints.length
        ? `: ${tp.constraints.map((x) => x.toLowerCase()).join(' + ')}`
        : ''
      return `T${i}${c}`
    })
    .join(', ')
  return (
    <div className="space-y-1.5 font-mono">
      <div className="flex flex-wrap items-baseline gap-1">
        {fn.visibility && (
          <span className="text-muted">{fn.visibility.toLowerCase()}</span>
        )}
        {fn.isEntry && <span className="text-muted">entry</span>}
        <span className="text-muted">fun</span>
        <span className="text-primary">
          {fn.module.name}::{fn.name}
        </span>
        {typeParams && <span className="text-secondary">&lt;{typeParams}&gt;</span>}
      </div>
      {fn.parameters.length > 0 && (
        <ul className="space-y-0.5">
          {fn.parameters.map((p, i) => (
            <li key={i} className="text-text" title={p.repr}>
              <span className="text-muted">{i}. </span>
              {formatSignatureType(p.repr)}
            </li>
          ))}
        </ul>
      )}
      {fn.return.length > 0 && (
        <div>
          <span className="text-muted">returns </span>
          <span className="text-secondary">
            {fn.return.map((r) => formatSignatureType(r.repr)).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}

function commandKind(cmd: TxCommand): string {
  switch (cmd.__typename) {
    case 'MoveCallCommand':
      return 'move call'
    case 'SplitCoinsCommand':
      return 'split coins'
    case 'MergeCoinsCommand':
      return 'merge coins'
    case 'TransferObjectsCommand':
      return 'transfer objects'
    case 'MakeMoveVecCommand':
      return 'make move vec'
    case 'PublishCommand':
      return 'publish'
    case 'UpgradeCommand':
      return 'upgrade'
  }
}

function SdkProgram({
  commands,
  inputs,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
}) {
  const code = buildSdkProgram(commands, inputs)
  return (
    <pre className="bg-bg/60 border-line overflow-x-auto border p-4 font-mono text-xs leading-6">
      <code>{linkifyAddresses(code)}</code>
    </pre>
  )
}

/** The PTB as a `sui client ptb` CLI command (see `buildCliProgram`). */
function CliProgram({
  commands,
  inputs,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
}) {
  const code = buildCliProgram(commands, inputs)
  return (
    <pre className="bg-bg/60 border-line overflow-x-auto border p-4 font-mono text-xs leading-6">
      <code>{linkifyAddresses(code)}</code>
    </pre>
  )
}

function ObjectChanges({ fx }: { fx: NonNullable<SuiTransaction['effects']> }) {
  const nodes = fx.objectChanges.nodes
  const created = nodes.filter((n) => n.idCreated && !n.idDeleted)
  const deleted = nodes.filter((n) => n.idDeleted)
  const mutated = nodes.filter((n) => !n.idCreated && !n.idDeleted)

  return (
    <PanelSection
      index={1}
      label="Object changes"
      action={
        <span className="text-muted font-mono text-xs">
          {nodes.length}
          {fx.objectChanges.pageInfo.hasNextPage ? '+' : ''}
        </span>
      }
    >
      {nodes.length === 0 ? (
        <Muted>no object changes.</Muted>
      ) : (
        <div className="space-y-4">
          <ObjectChangeGroup label="created" nodes={created} />
          <ObjectChangeGroup label="mutated" nodes={mutated} />
          <ObjectChangeGroup label="deleted" nodes={deleted} />
        </div>
      )}
    </PanelSection>
  )
}

function ObjectChangeGroup({
  label,
  nodes,
}: {
  label: string
  nodes: NonNullable<SuiTransaction['effects']>['objectChanges']['nodes']
}) {
  if (nodes.length === 0) return null
  return (
    <div>
      <span className="text-muted font-mono text-[0.6875rem] tracking-wide lowercase">
        {label} · {nodes.length}
      </span>
      <ul className="divide-line mt-1.5 divide-y font-mono text-xs">
        {nodes.map((n) => {
          const type = n.outputState?.asMoveObject?.contents?.type.repr
          return (
            <li key={n.address} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
              <LinkedHash value={n.address} />
              {type && (
                <span className="text-muted min-w-0">
                  <TypeLink type={type} />
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BalanceChanges({ fx }: { fx: NonNullable<SuiTransaction['effects']> }) {
  const nodes = fx.balanceChanges.nodes
  return (
    <PanelSection
      index={2}
      label="Balance changes"
      action={
        <span className="text-muted font-mono text-xs">
          {nodes.length}
          {fx.balanceChanges.pageInfo.hasNextPage ? '+' : ''}
        </span>
      }
    >
      {nodes.length === 0 ? (
        <Muted>no balance changes.</Muted>
      ) : (
        <ul className="divide-line divide-y font-mono text-xs">
          {nodes.map((n, i) => {
            const positive = n.amount != null && BigInt(n.amount) >= 0n
            return (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2">
                  {n.owner ? <LinkedHash value={n.owner.address} /> : <Muted>—</Muted>}
                  {n.coinType && (
                    <span className="text-muted" title={n.coinType.repr}>
                      {formatType(n.coinType.repr)}
                    </span>
                  )}
                </span>
                <span className={positive ? 'text-secondary' : 'text-danger'}>
                  {positive ? '+' : ''}
                  {formatSui(n.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </PanelSection>
  )
}

const EVENTS_PREVIEW = 3

function Events({ fx }: { fx: NonNullable<SuiTransaction['effects']> }) {
  const nodes = fx.events.nodes
  const [showAll, setShowAll] = useState(false)
  const clamped = nodes.length > EVENTS_PREVIEW
  const shown = showAll || !clamped ? nodes : nodes.slice(0, EVENTS_PREVIEW)

  return (
    <PanelSection
      index={3}
      label="Events"
      action={
        <span className="text-muted font-mono text-xs">
          {nodes.length}
          {fx.events.pageInfo.hasNextPage ? '+' : ''}
        </span>
      }
    >
      {nodes.length === 0 ? (
        <Muted>no events emitted.</Muted>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((e, i) => (
              <li key={i} className="border-line bg-bg/40 border p-3 font-mono text-xs">
                {e.contents && (
                  <div className="mb-2">
                    <TypeLink type={e.contents.type.repr} />
                  </div>
                )}
                {e.contents != null && <JsonBlock value={e.contents.json} />}
              </li>
            ))}
          </ul>
          {clamped && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-muted hover:text-primary mt-3 inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
            >
              {showAll ? (
                <>
                  <ChevronUp size={13} />
                  show less
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  show all ({nodes.length})
                </>
              )}
            </button>
          )}
        </>
      )}
    </PanelSection>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="border-line text-muted border px-1.5 py-0.5 text-[0.6875rem] lowercase">
      {children}
    </span>
  )
}

/** A compact stacked stat cell — label over value, aligns into grid columns. */
function GasStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-[0.625rem] tracking-wide uppercase">
        {label}
      </span>
      <span className="text-text tabular-nums break-words">{value}</span>
    </div>
  )
}

function formatJson(json: unknown): string {
  if (json == null) return '—'
  if (typeof json === 'object') return JSON.stringify(json)
  return String(json)
}
