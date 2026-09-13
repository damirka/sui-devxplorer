import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Fuel } from 'lucide-react'
import { AddressLink } from '@/components/ui/AddressLink'
import { ErrorText } from '@/components/ui/ErrorText'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { DANGER_PRE } from '@/components/ui/codeBlock'
import { LinkedHash, TypeLink, useSearchHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { tipLagMs } from '@/lib/checkpoint'
import { netGasUsed } from '@/lib/gas'
import { cn } from '@/lib/cn'
import { truncateMiddle } from '@/lib/search'
import { formatAgeAgo, formatNumber, formatSui, formatTimestamp } from '@/lib/format'
import {
  fetchTransaction,
  type MoveFn,
  type SuiTransaction,
  type TxCommand,
  type TxListItem,
} from '@/lib/transaction'
import { TxStatus } from './TransactionRow'
import { MenuRow, menuRowClass } from '@/components/ui/MenuRow'

/**
 * One transaction in the live feed — a summary line (digest, age, sender, the
 * checkpoint that sealed it, gas, status) that expands to the transaction's
 * detail: its header fields and a line per command of its programmable block.
 * The counterpart of `CheckpointRow`: the parent owns `open` so it can enforce
 * one-open-at-a-time and freeze the feed while a row is open, and `now` is the
 * shared wall-clock tick that keeps every row's age advancing together.
 *
 * The whole line toggles on click (as on a checkpoint row), but the sender is a
 * real link — a link can't nest inside a button, so the line is a plain
 * container with the click handler, the index + chevron is the focusable
 * button (its keyboard activation bubbles as a click), and the sender cell
 * stops the click from reaching the toggle. The expanded detail carries the
 * remaining links and copy buttons, plus a jump to the full transaction view.
 */
export function TransactionFeedRow({
  index,
  tx,
  now,
  open,
  onToggle,
}: {
  index: number
  tx: TxListItem
  now: number
  open: boolean
  onToggle: () => void
}) {
  const lag = tipLagMs(tx.timestamp, now)
  return (
    <li>
      <div
        onClick={onToggle}
        className={menuRowClass({ wrap: true, hover: true, className: 'w-full cursor-pointer' })}
      >
        {/* No onClick of its own: a keyboard activation dispatches a click that
            bubbles to the line, so one handler serves mouse and keyboard. */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'collapse transaction' : 'expand transaction'}
          className="inline-flex shrink-0 items-center gap-x-3"
        >
          <RowIndex n={index} />
          <ChevronRight
            size={13}
            className={cn('text-muted shrink-0 transition-transform', open && 'rotate-90')}
          />
        </button>
        <span className="text-primary hash w-[7rem] shrink-0" title={tx.digest}>
          {truncateMiddle(tx.digest)}
        </span>
        <span className="text-muted shrink-0 tabular-nums">
          {formatAgeAgo(lag)}
        </span>
        {tx.sender && (
          <span
            className="text-muted hidden min-w-0 items-center gap-1.5 sm:inline-flex"
            // Clicks on the link / copy button open the address, not the row.
            onClick={(e) => e.stopPropagation()}
          >
            by <AddressLink value={tx.sender} name={tx.senderName} />
          </span>
        )}
        <span className="text-muted ml-auto inline-flex shrink-0 items-center gap-x-4 tabular-nums">
          <span className="hidden sm:inline" title="sealed in checkpoint">
            {tx.checkpoint == null ? '—' : `#${formatNumber(tx.checkpoint)}`}
          </span>
          <span
            className="inline-flex w-[8.5rem] items-center justify-end gap-1 whitespace-nowrap"
            title="gas used"
          >
            <Fuel size={12} />
            {tx.gas == null ? '—' : formatSui(tx.gas)}
          </span>
          <TxStatus status={tx.status} className="w-[4.5rem] text-right" />
        </span>
      </div>
      {open && <TransactionDetail digest={tx.digest} />}
    </li>
  )
}

/** The expanded panel under a feed row — loaded lazily, only once the row is
 *  opened (the feed is frozen meanwhile, so the row holds still). */
function TransactionDetail({ digest }: { digest: string }) {
  const { network } = useNetwork()
  const tx = useAsync((signal) => fetchTransaction(network, digest, signal), [network, digest])
  return (
    <div className="border-line bg-bg border-t px-3 py-4">
      {tx.data ? (
        <TransactionSummary tx={tx.data} />
      ) : tx.loading ? (
        <SkeletonLines count={4} />
      ) : tx.error ? (
        <ErrorText error={tx.error} />
      ) : (
        <Muted>transaction not found.</Muted>
      )}
    </div>
  )
}

/** The transaction's header fields, its execution error if it failed, and its
 *  commands one per line — enough to tell what it did without leaving the feed;
 *  the full view (inputs, argument wiring, changes, events) is one link away. */
function TransactionSummary({ tx }: { tx: SuiTransaction }) {
  const searchHref = useSearchHref()
  const fx = tx.effects
  const gas = tx.gasInput
  const ptb = tx.kind?.__typename === 'ProgrammableTransaction' ? tx.kind : null
  const used = netGasUsed(fx?.gasEffects?.gasSummary)
  const err = fx?.executionError
  const errorLines = err
    ? [
        err.identifier || null,
        err.abortCode != null ? `abort code ${err.abortCode}` : null,
        err.message || null,
      ].filter((l): l is string => !!l)
    : []

  return (
    <div className="space-y-5">
      <FieldGrid cols={3}>
        <Field label="digest">
          {tx.digest ? <LinkedHash value={tx.digest} /> : <Muted>—</Muted>}
        </Field>
        <Field label="sender">
          {tx.sender ? <AddressLink value={tx.sender.address} /> : <Muted>—</Muted>}
        </Field>
        <Field label="status">
          <span
            className={cn(
              'font-mono text-sm',
              fx?.status === 'FAILURE'
                ? 'text-danger'
                : fx?.status === 'SUCCESS'
                  ? 'text-secondary'
                  : 'text-muted',
            )}
          >
            {fx?.status?.toLowerCase() ?? '—'}
          </span>
        </Field>
        <Field label="executed">
          <Value>{formatTimestamp(fx?.timestamp)}</Value>
        </Field>
        <Field label="checkpoint">
          <Value>
            {fx?.checkpoint ? `#${formatNumber(fx.checkpoint.sequenceNumber)}` : '—'}
          </Value>
        </Field>
        <Field label="epoch">
          <Value>{fx?.epoch?.epochId ?? '—'}</Value>
        </Field>
        <Field label="gas used">
          <Value>{used == null ? '—' : formatSui(used)}</Value>
        </Field>
        <Field label="gas budget">
          <Value>{gas?.gasBudget ? formatSui(gas.gasBudget) : '—'}</Value>
        </Field>
        <Field label="gas owner">
          {gas?.gasSponsor ? <AddressLink value={gas.gasSponsor.address} /> : <Muted>—</Muted>}
        </Field>
      </FieldGrid>

      {errorLines.length > 0 && (
        <div>
          <span className="text-danger font-mono text-[0.6875rem] tracking-wide lowercase">
            execution error
          </span>
          <pre className={DANGER_PRE}>
            <code>{errorLines.join('\n')}</code>
          </pre>
        </div>
      )}

      <div className="space-y-3">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="panel-label">
            commands
            {ptb
              ? ` · ${ptb.commands.nodes.length}${ptb.commands.pageInfo.hasNextPage ? '+' : ''}`
              : ''}
          </span>
          <span className="rule" />
          {tx.digest && (
            <Link
              to={searchHref(tx.digest)}
              title="open the full transaction"
              className="text-muted hover:text-primary font-mono text-xs transition-colors"
            >
              full transaction ↗
            </Link>
          )}
        </header>
        {ptb ? (
          ptb.commands.nodes.length > 0 ? (
            <ol className="divide-line divide-y font-mono text-xs">
              {ptb.commands.nodes.map((cmd, i) => (
                <MenuRow key={i} n={i} wrap className="py-2">
                  <CommandSummary cmd={cmd} />
                </MenuRow>
              ))}
            </ol>
          ) : tx.decodeError ? (
            <ErrorText error={`couldn't decode the transaction bytes: ${tx.decodeError}`} />
          ) : (
            <Muted>no commands.</Muted>
          )
        ) : (
          <Muted>
            {tx.kind
              ? `${tx.kind.__typename} — a system transaction, no programmable block.`
              : '—'}
          </Muted>
        )}
      </div>
    </div>
  )
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-text tabular-nums">{children}</span>
}

/** One command on one line: a Move call's target (package → module → function,
 *  each linked, plus its concrete type arguments), or a builtin's name with a
 *  note of what it operates on. Argument wiring is left to the full view. */
function CommandSummary({ cmd }: { cmd: TxCommand }) {
  switch (cmd.__typename) {
    case 'MoveCallCommand':
      return <MoveCallTarget fn={cmd.function} typeArguments={cmd.typeArguments} />
    case 'SplitCoinsCommand':
      return <Builtin name="split_coins" note={plural(cmd.amounts.length, 'amount')} />
    case 'MergeCoinsCommand':
      return <Builtin name="merge_coins" note={plural(cmd.coins.length, 'source')} />
    case 'TransferObjectsCommand':
      return <Builtin name="transfer_objects" note={plural(cmd.inputs.length, 'object')} />
    case 'MakeMoveVecCommand':
      return (
        <Builtin name="make_move_vec" note={plural(cmd.elements.length, 'element')}>
          {cmd.type && (
            <span className="text-muted">
              &lt;
              <TypeLink type={cmd.type.repr} />
              &gt;
            </span>
          )}
        </Builtin>
      )
    case 'PublishCommand':
      return (
        <Builtin
          name="publish"
          note={`${plural(cmd.modules.length, 'module')}, ${plural(cmd.dependencies.length, 'dependency', 'dependencies')}`}
        />
      )
    case 'UpgradeCommand':
      return (
        <Builtin name="upgrade" note={plural(cmd.modules.length, 'module')}>
          <PkgLink address={cmd.currentPackage} />
        </Builtin>
      )
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A builtin (non-Move-call) command: its name, an optional operand, a note. */
function Builtin({
  name,
  note,
  children,
}: {
  name: string
  note: string
  children?: ReactNode
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
      <span className="text-primary">{name}</span>
      {children}
      <span className="text-muted">{note}</span>
    </span>
  )
}

/** `pkg::module::function<T…>` — the package links to its page, the function to
 *  its definition there; type arguments are clickable types. */
function MoveCallTarget({ fn, typeArguments }: { fn: MoveFn | null; typeArguments: string[] }) {
  const searchHref = useSearchHref()
  if (!fn) return <span className="text-danger">unknown_function</span>
  const pkg = fn.module.package.address
  const target = `${pkg}::${fn.module.name}::${fn.name}`
  return (
    <span className="hash min-w-0 break-all">
      <PkgLink address={pkg} />
      <span className="text-muted">::{fn.module.name}::</span>
      <Link to={searchHref(target)} title={target} className="text-primary hover:underline">
        {fn.name}
      </Link>
      {typeArguments.length > 0 && (
        <span className="text-muted">
          &lt;
          {typeArguments.map((t, i) => (
            <Fragment key={i}>
              {i > 0 && ', '}
              <TypeLink type={t} />
            </Fragment>
          ))}
          &gt;
        </span>
      )}
    </span>
  )
}

/** A truncated, linked package address (no copy button — kept inline-light). */
function PkgLink({ address }: { address: string }) {
  const searchHref = useSearchHref()
  return (
    <Link
      to={searchHref(address)}
      title={address}
      className="text-text hover:text-primary hover:underline"
    >
      {truncateMiddle(address)}
    </Link>
  )
}
