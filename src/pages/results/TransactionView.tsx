import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkedHash, TypeLink, useSearchHref, linkifyMoveText } from '@/components/ui/links'
import { JsonBlock, linkifyAddresses } from '@/components/ui/JsonBlock'
import { HoverCard } from '@/components/ui/HoverCard'
import { CopyButton } from '@/components/ui/CopyButton'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { CoinIcon } from '@/components/ui/CoinIcon'
import { DANGER_PRE } from '@/components/ui/codeBlock'
import { cn } from '@/lib/cn'
import { truncateMiddle } from '@/lib/search'
import {
  formatSui,
  formatTokenAmount,
  formatTimestamp,
  formatType,
  formatSignatureType,
} from '@/lib/format'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { reverseResolveMvrBulk, mvrAppUrl } from '@/lib/mvr'
import {
  fetchTransaction,
  fetchFunctionDisassembly,
  usedResults,
  netGasUsed,
  failedCommandIndex,
  failedInstructionOffset,
  inputType,
  addressLikeArity,
  type SuiTransaction,
  type TxInput,
  type TxCommand,
  type TxArgument,
  type ObjectChangeNode,
  type MoveFn,
} from '@/lib/transaction'
import { fetchCoinMetadata, type CoinMeta } from '@/lib/coin'
import {
  buildSdkProgram,
  buildCliProgram,
  programToText,
  programVarNames,
  PUBLISH_RESULT_TYPE,
  UPGRADE_RESULT_TYPE,
  type ProgramNames,
} from '@/lib/program'
import { ResultHeader } from './ResultHeader'

/** Variable names for the PTB's object inputs (`coin_sui`, `kiosk`, …) and
 * command results — so `Input(ix)` / `Result(cmd)` arguments render by name
 * instead of `inputN` / `resN`. Provided by `ProgramPanel`. */
const ProgramNamesContext = createContext<ProgramNames>({
  inputs: new Map(),
  results: new Map(),
})

/** Where a failed tx aborted, so the failed command's disassembly can highlight
 * (and scroll to) the offending instruction. `nonce` bumps when the user clicks
 * the `(instruction N)` link in the error to focus it. */
interface AbortFocus {
  failedCommand: number | null
  failedInstruction: number | null
  nonce: number
}
const AbortFocusContext = createContext<AbortFocus>({
  failedCommand: null,
  failedInstruction: null,
  nonce: 0,
})

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
  // On failure, the command index the PTB aborted in (if the error names one) —
  // used to red-flag that command in the script.
  const failedCommand =
    fx?.status === 'FAILURE'
      ? failedCommandIndex(fx.executionError?.message)
      : null
  const failedInstruction =
    fx?.status === 'FAILURE'
      ? failedInstructionOffset(fx.executionError?.message)
      : null
  const [inputsOpen, setInputsOpen] = useState(false)
  // Bumped when the user clicks the error's `(instruction N)` link — the failed
  // command's disassembly watches it to open + scroll to the offending line.
  const [asmFocus, setAsmFocus] = useState(0)

  return (
    <AbortFocusContext.Provider
      value={{ failedCommand, failedInstruction, nonce: asmFocus }}
    >
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
                  {(() => {
                    const ee = fx.executionError
                    // identifier + abort code are plain; the message is where a
                    // `pkg::module::fn` path appears — linkify it.
                    const head = [
                      ee.identifier || null,
                      ee.abortCode != null ? `abort code ${ee.abortCode}` : null,
                    ].filter(Boolean) as string[]
                    return (
                      <>
                        {head.map((line) => (
                          <Fragment key={line}>
                            {line}
                            {'\n'}
                          </Fragment>
                        ))}
                        {ee.message ? (
                          <AbortMessage
                            message={ee.message}
                            onFocusInstruction={
                              failedCommand != null
                                ? () => setAsmFocus((n) => n + 1)
                                : undefined
                            }
                          />
                        ) : (
                          head.length === 0 && 'transaction failed'
                        )}
                      </>
                    )
                  })()}
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
            failedCommand={failedCommand}
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
    </AbortFocusContext.Provider>
  )
}

/** The execution-error message, with any `(instruction N)` turned into a button
 * that jumps to the failed line in the disassembly; the rest is linkified. */
function AbortMessage({
  message,
  onFocusInstruction,
}: {
  message: string
  onFocusInstruction?: () => void
}) {
  const m = /\(instruction (\d+)\)/.exec(message)
  if (!m || !onFocusInstruction) return <>{linkifyMoveText(message)}</>
  return (
    <>
      {linkifyMoveText(message.slice(0, m.index))}
      (instruction{' '}
      <button
        type="button"
        onClick={onFocusInstruction}
        className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary"
        title="jump to the failed instruction in the disassembly"
      >
        {m[1]}
      </button>
      ){linkifyMoveText(message.slice(m.index + m[0].length))}
    </>
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
 * The Program panel: a tabbed view of the programmable block. The "script" tab
 * (default) is the readable pseudo-Move script with hover cards; the "ts sdk"
 * and "sui cli" tabs are copy-pasteable code. The copy button copies whichever
 * is active.
 */
function ProgramPanel({
  commands,
  inputs,
  hasNextPage,
  failedCommand,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
  hasNextPage: boolean
  /** 0-based index of the command that aborted (failed txs), or null. */
  failedCommand?: number | null
}) {
  const [tab, setTab] = useState<'script' | 'sdk' | 'cli'>('script')
  const empty = commands.length === 0
  // Build each form once per (commands, inputs) and reuse for both the copy
  // button and the rendered pane — the active form was otherwise rebuilt on
  // every render (and twice over for the sdk/cli tabs).
  const sdk = useMemo(() => buildSdkProgram(commands, inputs), [commands, inputs])
  const cli = useMemo(() => buildCliProgram(commands, inputs), [commands, inputs])
  const script = useMemo(() => programToText(commands, inputs), [commands, inputs])
  const names = useMemo(() => programVarNames(commands, inputs), [commands, inputs])
  const copyValue = tab === 'sdk' ? sdk : tab === 'cli' ? cli : script
  const copyLabel =
    tab === 'sdk' ? 'Copy as TS SDK' : tab === 'cli' ? 'Copy CLI command' : 'Copy script'

  return (
    <ProgramNamesContext.Provider value={names}>
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
              <CommandScript
                commands={commands}
                inputs={inputs}
                failedCommand={failedCommand}
              />
            ) : (
              <ProgramCode code={tab === 'sdk' ? sdk : cli} />
            )}
          </>
        )}
      </PanelSection>
    </Panel>
    </ProgramNamesContext.Provider>
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
  failedCommand,
}: {
  commands: TxCommand[]
  inputs: TxInput[]
  failedCommand?: number | null
}) {
  const used = usedResults(commands)

  // A two-column grid (index gutter | code) so the line-number column reads like
  // GitHub and the failed-command highlight can span the whole row.
  return (
    <div className="bg-bg/60 border-line grid grid-cols-[auto_1fr] border p-4 font-mono text-xs leading-6">
      {commands.map((cmd, i) => (
        <CommandStatement
          key={i}
          index={i}
          cmd={cmd}
          inputs={inputs}
          commands={commands}
          assigned={used.has(i)}
          failed={i === failedCommand}
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
  failed,
}: {
  index: number
  cmd: TxCommand
  inputs: TxInput[]
  commands: TxCommand[]
  assigned: boolean
  failed: boolean
}) {
  return (
    <>
      {/* Command-index gutter (GitHub-style line numbers): 0-based to match
          `resN` and the index a failed tx reports. `select-none` keeps it out of
          manual copies; the copy button copies the generated text, not the DOM. */}
      <span
        aria-hidden
        className={cn(
          'border-line shrink-0 select-none border-r pr-4 text-right tabular-nums',
          failed ? 'bg-danger/15 text-danger' : 'text-muted/50',
        )}
      >
        {index}
      </span>
      <div
        className={cn(
          'min-w-0 break-words whitespace-pre-wrap pl-4',
          failed && 'bg-danger/15',
        )}
      >
        {assigned && (
          <>
            <ResultToken cmd={index} ix={null} commands={commands} />
            <span className="text-muted"> = </span>
          </>
        )}
        <CallExpr cmd={cmd} inputs={inputs} commands={commands} />
        <span className="text-muted">;</span>
        {cmd.__typename === 'MoveCallCommand' && cmd.function && (
          <MoveCallAsm fn={cmd.function} cmdIndex={index} />
        )}
      </div>
    </>
  )
}

/** A lazy, toggleable disassembly of a MoveCall's function body. */
function MoveCallAsm({ fn, cmdIndex }: { fn: MoveFn; cmdIndex: number }) {
  const { network } = useNetwork()
  const [open, setOpen] = useState(false)
  const failedLineRef = useRef<HTMLDivElement>(null)

  // The failed instruction belongs to *this* command only when it's the one
  // that aborted; the disassembly is per-function, so the offset maps to a line.
  const abort = useContext(AbortFocusContext)
  const failedInstruction =
    abort.failedCommand === cmdIndex ? abort.failedInstruction : null

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

  // Clicking the error's `(instruction N)` link bumps the nonce → open this asm.
  useEffect(() => {
    if (abort.nonce > 0 && failedInstruction != null) setOpen(true)
  }, [abort.nonce, failedInstruction])

  // Once open and loaded, scroll the failed line into view.
  useEffect(() => {
    if (open && failedInstruction != null) {
      failedLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [open, abort.nonce, data, failedInstruction])

  const failedLine =
    failedInstruction != null ? new RegExp(`^\\s*${failedInstruction}:`) : null

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
              <code>
                {data.split('\n').map((line, i) => {
                  const isFailed = !!failedLine && failedLine.test(line)
                  return (
                    <div
                      key={i}
                      ref={isFailed ? failedLineRef : undefined}
                      className={
                        isFailed ? 'bg-danger/20 text-danger -mx-3 px-3' : undefined
                      }
                    >
                      {line || ' '}
                    </div>
                  )
                })}
              </code>
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
          <FnTarget fn={cmd.function} />
          <TypeArgs args={cmd.typeArguments} />({seq(cmd.arguments)})
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

/** The concrete `<T0, T1>` type arguments of a MoveCall — each a clickable type
 * (addresses trimmed). Nothing for a non-generic call. */
function TypeArgs({ args }: { args: string[] }) {
  if (!args.length) return null
  return (
    <span className="text-muted">
      &lt;
      {args.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          <TypeLink type={t} />
        </Fragment>
      ))}
      &gt;
    </span>
  )
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
        <InputName ix={arg.ix} />
      </span>
    </HoverCard>
  )
}

/** An object input's variable name (`coin_sui`, `kiosk`, …) when it has one, else
 * the generic `inputN`. */
function InputName({ ix }: { ix: number }) {
  const { inputs } = useContext(ProgramNamesContext)
  return <>{inputs.get(ix) ?? `input${ix}`}</>
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
  const { results } = useContext(ProgramNamesContext)
  const name = results.get(cmd) ?? `res${cmd}`
  const label = ix == null ? name : `${name}.${ix}`
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
      <div className="text-secondary">
        <InputName ix={ix} />
      </div>
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

/** A built program string (TS SDK or CLI) rendered with ids linkified. */
function ProgramCode({ code }: { code: string }) {
  return (
    <pre className="bg-bg/60 border-line overflow-x-auto border p-4 font-mono text-xs leading-6">
      <code>{linkifyAddresses(code)}</code>
    </pre>
  )
}

// Dynamic-field wrappers: `0x2::dynamic_field::Field<…>` and
// `0x2::dynamic_object_field::Field<…>` (the address matched whether written
// short or fully padded). These dominate object-change lists for table/bag-heavy
// txs, so they get their own tab.
const DF_TYPE_RE = /^0x0*2::dynamic_(?:object_)?field::Field(?:<|$)/

/** A change's Move type — from the output state, or the input state for a
 * deleted object (whose output state is gone). `null` for packages / unknown. */
function changeType(n: ObjectChangeNode): string | null {
  return (
    n.outputState?.asMoveObject?.contents?.type.repr ??
    n.inputState?.asMoveObject?.contents?.type.repr ??
    null
  )
}

function isDynamicFieldChange(n: ObjectChangeNode): boolean {
  const t = changeType(n)
  return t != null && DF_TYPE_RE.test(t)
}

function ObjectChanges({ fx }: { fx: NonNullable<SuiTransaction['effects']> }) {
  const { network } = useNetwork()
  const nodes = fx.objectChanges.nodes

  // Split dynamic-field changes onto their own tab; everything else (owned /
  // shared / immutable objects + packages) stays on the main tab.
  const dfNodes = nodes.filter(isDynamicFieldChange)
  const objNodes = nodes.filter((n) => !isDynamicFieldChange(n))
  const hasDf = dfNodes.length > 0
  const [tab, setTab] = useState<'objects' | 'df'>('objects')

  // Every package touched by this tx, named in one bulk MVR reverse-resolution.
  const pkgIds = nodes
    .filter((n) => n.outputState?.asMovePackage)
    .map((n) => n.address)
  const { data: names } = useAsync(
    (signal) =>
      pkgIds.length
        ? reverseResolveMvrBulk(network, pkgIds, signal)
        : Promise.resolve<Record<string, string>>({}),
    [network, pkgIds.join(',')],
  )
  const mvrNames = names ?? {}

  const showDf = hasDf && tab === 'df'

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
        <>
          {/* No tabs unless there are dynamic-field changes to split out. */}
          {hasDf && (
            <div className="border-line mb-4 flex gap-1 border-b">
              <TabButton active={tab === 'objects'} onClick={() => setTab('objects')}>
                objects · {objNodes.length}
              </TabButton>
              <TabButton active={tab === 'df'} onClick={() => setTab('df')}>
                dynamic fields · {dfNodes.length}
              </TabButton>
            </div>
          )}
          <ObjectChangeList
            nodes={showDf ? dfNodes : objNodes}
            mvrNames={mvrNames}
            empty={showDf ? 'no dynamic field changes.' : 'no object changes.'}
          />
        </>
      )}
    </PanelSection>
  )
}

/** The created / mutated / deleted grouping for a set of object-change nodes. */
function ObjectChangeList({
  nodes,
  mvrNames,
  empty,
}: {
  nodes: ObjectChangeNode[]
  mvrNames: Record<string, string>
  empty: string
}) {
  if (nodes.length === 0) return <Muted>{empty}</Muted>
  const created = nodes.filter((n) => n.idCreated && !n.idDeleted)
  const deleted = nodes.filter((n) => n.idDeleted)
  const mutated = nodes.filter((n) => !n.idCreated && !n.idDeleted)
  return (
    <div className="space-y-4">
      <ObjectChangeGroup label="created" nodes={created} mvrNames={mvrNames} />
      <ObjectChangeGroup label="mutated" nodes={mutated} mvrNames={mvrNames} />
      <ObjectChangeGroup label="deleted" nodes={deleted} mvrNames={mvrNames} />
    </div>
  )
}

function ObjectChangeGroup({
  label,
  nodes,
  mvrNames,
}: {
  label: string
  nodes: ObjectChangeNode[]
  mvrNames: Record<string, string>
}) {
  if (nodes.length === 0) return null
  return (
    <div>
      <span className="text-muted font-mono text-[0.6875rem] tracking-wide lowercase">
        {label} · {nodes.length}
      </span>
      <ul className="divide-line mt-1.5 divide-y font-mono text-xs">
        {nodes.map((n) => {
          // A created/mutated package has no `asMoveObject` — surface its type as
          // "package" (with its MVR name when one is registered) instead of blank.
          const isPackage = !!n.outputState?.asMovePackage
          const type = changeType(n)
          const name = mvrNames[n.address]
          return (
            <li key={n.address} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
              <LinkedHash value={n.address} />
              {isPackage ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-primary">package</span>
                  {name && (
                    <a
                      href={mvrAppUrl(name)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`${name} · view on Move Registry`}
                      className="text-muted hover:text-primary truncate transition-colors"
                    >
                      {name}
                    </a>
                  )}
                </span>
              ) : (
                type && (
                  <span className="text-muted min-w-0">
                    <TypeLink type={type} />
                  </span>
                )
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Group a raw integer amount with thousands separators — the fallback when a
 * coin's decimals aren't known (no registered CoinMetadata, or still loading). */
function rawAmount(raw: string | null): string {
  if (raw == null) return '—'
  try {
    return BigInt(raw).toLocaleString('en-US')
  } catch {
    return raw
  }
}

function BalanceChanges({ fx }: { fx: NonNullable<SuiTransaction['effects']> }) {
  const { network } = useNetwork()
  const nodes = fx.balanceChanges.nodes
  // Balance changes can run to hundreds of rows (e.g. a mass airdrop / claim),
  // so the list is collapsed by default — and the per-coin metadata fetch is
  // deferred until it's actually opened.
  const [open, setOpen] = useState(false)

  // Amounts are raw integers in each coin's own smallest unit, so they can only
  // be rendered as a decimal once we know that coin's decimals — fetch the
  // metadata (decimals + symbol) for every coin type referenced, in one request.
  const coinTypes = nodes
    .map((n) => n.coinType?.repr)
    .filter((t): t is string => !!t)
  const { data: meta } = useAsync(
    (signal) =>
      open
        ? fetchCoinMetadata(network, coinTypes, signal)
        : Promise.resolve(new Map<string, CoinMeta>()),
    [network, open, coinTypes.join(',')],
  )

  return (
    <PanelSection
      index={2}
      label={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? 'collapse' : 'expand'}
          className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="panel-label">Balance changes</span>
        </button>
      }
      action={
        <span className="text-muted font-mono text-xs">
          {nodes.length}
          {fx.balanceChanges.pageInfo.hasNextPage ? '+' : ''}
        </span>
      }
    >
      {!open ? null : nodes.length === 0 ? (
        <Muted>no balance changes.</Muted>
      ) : (
        <ul className="divide-line divide-y font-mono text-xs">
          {nodes.map((n, i) => {
            const positive = n.amount != null && BigInt(n.amount) >= 0n
            const m = n.coinType ? meta?.get(n.coinType.repr) : undefined
            // Scale by the coin's decimals + label with its symbol when known;
            // otherwise show the raw integer (never assume SUI / 9 decimals).
            const amount = m
              ? formatTokenAmount(n.amount, m.decimals, m.symbol)
              : rawAmount(n.amount)
            return (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2">
                  {n.owner ? <LinkedHash value={n.owner.address} /> : <Muted>—</Muted>}
                  {n.coinType && (
                    <span className="text-muted flex items-center gap-1.5" title={n.coinType.repr}>
                      <CoinIcon url={m?.iconUrl} symbol={m?.symbol} className="h-4 w-4" />
                      {formatType(n.coinType.repr)}
                    </span>
                  )}
                </span>
                <span className={positive ? 'text-secondary' : 'text-danger'}>
                  {positive ? '+' : ''}
                  {amount}
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
