import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { CopyButton } from '@/components/ui/CopyButton'
import { CODE_PRE } from '@/components/ui/codeBlock'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchFunctionDisassembly } from '@/lib/transaction'
import { formatSignatureType } from '@/lib/format'
import type { MoveFunctionDef } from '@/lib/object'

/**
 * The structured definition of a navigated-to function (`addr::module::name`):
 * its signature (visibility, type params, parameter + return types) plus a
 * toggle that lazily loads the disassembled body. The function counterpart to
 * the struct `TypeDefinitionPanel`.
 */
export function FunctionDefinitionPanel({
  packageId,
  module,
  def,
}: {
  packageId: string
  module: string
  def: MoveFunctionDef
}) {
  return (
    <Panel>
      <PanelSection
        label="Function"
        action={
          <span className="text-muted font-mono text-xs">
            {module}::{def.name}
          </span>
        }
      >
        <FunctionSignature def={def} />
        <FunctionBody packageId={packageId} module={module} name={def.name} />
      </PanelSection>
    </Panel>
  )
}

/** Visibility keyword as Move source spells it. */
function visibilityWord(v: string | null): string | null {
  switch (v) {
    case 'PUBLIC':
      return 'public'
    case 'FRIEND':
      return 'public(friend)'
    case 'PRIVATE':
    case null:
      return null
    default:
      return v.toLowerCase()
  }
}

function FunctionSignature({ def }: { def: MoveFunctionDef }) {
  const vis = visibilityWord(def.visibility)
  const typeParams = def.typeParameters
    .map((tp, i) => {
      const c = tp.constraints.length
        ? `: ${tp.constraints.map((x) => x.toLowerCase()).join(' + ')}`
        : ''
      return `T${i}${c}`
    })
    .join(', ')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm">
        {vis && <span className="text-muted">{vis}</span>}
        {def.isEntry && <span className="text-muted">entry</span>}
        <span className="text-muted">fun</span>
        <span className="text-primary">{def.name}</span>
        {typeParams && <span className="text-secondary">&lt;{typeParams}&gt;</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="panel-label">parameters</span>
        {def.parameters.length > 0 ? (
          <ul className="border-line divide-line divide-y border font-mono text-xs">
            {def.parameters.map((p, i) => (
              <li key={i} className="flex gap-3 px-3 py-1.5" title={p.repr}>
                <span className="text-muted tabular-nums">{i}</span>
                <span className="hash break-all">{formatSignatureType(p.repr)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted font-mono text-xs">none</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="panel-label">returns</span>
        {def.return.length > 0 ? (
          <span className="hash break-all font-mono text-xs">
            {def.return.map((r) => formatSignatureType(r.repr)).join(', ')}
          </span>
        ) : (
          <span className="text-muted font-mono text-xs">nothing</span>
        )}
      </div>
    </div>
  )
}

/** Lazily-loaded, toggleable disassembly of the function's body. */
function FunctionBody({
  packageId,
  module,
  name,
}: {
  packageId: string
  module: string
  name: string
}) {
  const { network } = useNetwork()
  const [open, setOpen] = useState(false)
  const { data, loading, error } = useAsync(
    (signal) =>
      open
        ? fetchFunctionDisassembly(network, packageId, module, name, signal)
        : Promise.resolve(null),
    [network, open, packageId, module, name],
  )

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-primary inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
        title="disassembled function body"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {open ? 'hide body' : 'show body'} (asm)
      </button>

      {open && (
        <div className="relative mt-2">
          {loading && <SkeletonLines count={6} />}
          {error && (
            <span className="text-danger font-mono text-xs">
              failed to load disassembly.
            </span>
          )}
          {!loading && !error && data == null && (
            <span className="text-muted font-mono text-xs">
              no disassembly — a native or fully-inlined function.
            </span>
          )}
          {data && (
            <>
              <CopyButton
                value={data}
                label="Copy disassembly"
                className="bg-bg/80 border-line absolute top-2 right-2 border p-1.5"
              />
              <pre className={CODE_PRE}>
                <code>{data}</code>
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
