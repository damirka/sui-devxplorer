import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchStructByPath, type SuiObject } from '@/lib/object'
import { ObjectOverview } from './ObjectOverview'
import { PackageModules } from './PackageModules'
import { StructDeclaration } from './moveType'
import { OwnedObjects } from './OwnedObjects'
import { Txs } from './Txs'

/**
 * Package result body: overview, the module browser (disassembly viewer), and
 * the shared owned-objects / transactions sections. Rendered for any object
 * whose `asMovePackage` is set — reached both from a bare package id (via
 * `ObjectView`) and from a `addr::module` path (via `PackageView`).
 */
export function PackageBody({
  data,
  defaultModule,
  highlightType,
}: {
  data: SuiObject
  /** Module to open when no `?module=` is in the URL (from a `::` search). */
  defaultModule?: string
  /** Struct/enum name to highlight in the disassembly (from a `::Type` path). */
  highlightType?: string
}) {
  const pkg = data.asMovePackage
  return (
    <div className="space-y-6">
      <ObjectOverview
        data={data}
        type={<span className="font-mono text-sm">package</span>}
      />

      {defaultModule && highlightType && (
        <TypeDefinitionPanel
          packageId={data.address}
          module={defaultModule}
          name={highlightType}
        />
      )}

      {pkg && (
        <PackageModules
          packageId={data.address}
          modules={pkg.modules?.nodes ?? []}
          version={pkg.version}
          hasNextPage={pkg.modules?.pageInfo.hasNextPage ?? false}
          defaultModule={defaultModule}
          highlightType={highlightType}
        />
      )}

      <OwnedObjects id={data.address} />
      <Txs
        id={data.address}
        relation="function"
        label="Transactions calling this package"
      />
    </div>
  )
}

/**
 * The structured source of a navigated-to type (`addr::module::Name`) — its
 * abilities, type params, and fields with each field type a link to its own
 * page, so you can navigate type-to-type without reading bytecode.
 */
function TypeDefinitionPanel({
  packageId,
  module,
  name,
}: {
  packageId: string
  module: string
  name: string
}) {
  const { network } = useNetwork()
  const { data, loading } = useAsync(
    (signal) => fetchStructByPath(network, packageId, module, name, signal),
    [network, packageId, module, name],
  )

  return (
    <Panel>
      <PanelSection
        label="Type definition"
        action={
          <span className="text-muted font-mono text-xs">
            {module}::{name}
          </span>
        }
      >
        {loading ? (
          <SkeletonLines count={3} />
        ) : data ? (
          <StructDeclaration def={data} />
        ) : (
          <span className="text-muted text-sm">
            no struct named {name} in {module} — see the disassembly below.
          </span>
        )}
      </PanelSection>
    </Panel>
  )
}
