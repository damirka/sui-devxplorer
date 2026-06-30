import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { CopyButton } from '@/components/ui/CopyButton'
import { CODE_PRE } from '@/components/ui/codeBlock'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchFunctionDisassembly } from '@/lib/transaction'
import type { MoveFunctionDef } from '@/lib/object'

/**
 * The disassembled body of a navigated-to function (`addr::module::name`). The
 * disassembly already opens with the full signature (visibility, type params,
 * parameter + return types), so we show just the asm rather than repeating that
 * structurally. The function counterpart to the struct `TypeDefinitionPanel`.
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
        <FunctionBody packageId={packageId} module={module} name={def.name} />
      </PanelSection>
    </Panel>
  )
}

/** The function's disassembled body (asm), loaded for the navigated-to function. */
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
