import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { CopyButton } from '@/components/ui/CopyButton'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { CODE_PRE } from '@/components/ui/codeBlock'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchFunctionDisassembly } from '@/lib/transaction'
import type { MoveFunctionDef } from '@/lib/object'
import { MoveFunctionSignatureView } from './moveType'

/**
 * A navigated-to function (`addr::module::name`). The signature is the headline —
 * visibility, type params, parameter + return types — since that's what you
 * usually want. The disassembled body can be large, so it's tucked behind a
 * collapsible toggle and only fetched once opened. The function counterpart to
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
  // Latch: fetch the disassembly only once the user first expands it.
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

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
        <div className="text-sm">
          <MoveFunctionSignatureView moduleName={module} fn={def} />
        </div>

        <div className="border-line mt-4 border-t pt-3">
          <CollapseToggle
            open={open}
            onToggle={() => {
              setOpen((v) => !v)
              setEverOpened(true)
            }}
            label="Disassembly"
          />
          {open && (
            <div className="mt-3">
              {everOpened && (
                <FunctionBody packageId={packageId} module={module} name={def.name} />
              )}
            </div>
          )}
        </div>
      </PanelSection>
    </Panel>
  )
}

/** The function's disassembled body (asm), fetched lazily when the section opens. */
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
  const { data, loading, error } = useAsync(
    (signal) => fetchFunctionDisassembly(network, packageId, module, name, signal),
    [network, packageId, module, name],
  )

  if (loading) return <SkeletonLines count={8} />
  if (error) {
    return (
      <span className="text-danger font-mono text-xs">failed to load disassembly.</span>
    )
  }
  if (data == null) {
    return (
      <span className="text-muted font-mono text-xs">
        no disassembly — a native or fully-inlined function.
      </span>
    )
  }

  return (
    <div className="relative">
      <CopyButton
        value={data}
        label="Copy disassembly"
        className="bg-bg/80 border-line absolute top-2 right-2 border p-1.5"
      />
      <pre className={CODE_PRE}>
        <code>{data}</code>
      </pre>
    </div>
  )
}
