import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchStructByPath,
  fetchFunctionSignature,
  type SuiObject,
} from '@/lib/object'
import { ObjectOverview } from './ObjectOverview'
import { PackageModules } from './PackageModules'
import { StructDeclaration } from './moveType'
import { TypeObjects } from './TypeObjects'
import { OwnedObjects } from './OwnedObjects'
import { Txs } from './Txs'
import { MvrPanel } from './MvrPanel'
import { PackageUpgradeCap } from './PackageUpgradeCap'
import { Balances } from './Balances'
import { PackageDependencies } from './PackageDependencies'
import { PackageDependents } from './PackageDependents'
import { FunctionDefinitionPanel } from './FunctionDefinition'

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
  mvrName,
}: {
  data: SuiObject
  /** Module to open when no `?module=` is in the URL (from a `::` search). */
  defaultModule?: string
  /** Struct/enum name to highlight in the disassembly (from a `::Type` path). */
  highlightType?: string
  /** MVR name this package was reached by (a forward name search), if any. */
  mvrName?: string
}) {
  const pkg = data.asMovePackage
  return (
    <div className="space-y-6">
      <MvrPanel packageId={data.address} name={mvrName} />

      <ObjectOverview data={data} isPackage />

      <PackageUpgradeCap packageId={data.address} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <PackageDependencies packageId={data.address} />
        <PackageDependents packageId={data.address} />
      </div>

      {defaultModule && highlightType && (
        <DefinitionPanel
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

      {/* Packages rarely hold coin balances — start collapsed and don't fetch
          until the user opens the panel. */}
      <Balances id={data.address} defaultOpen={false} />
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
 * A navigated-to `addr::module::name` can be either a function or a datatype.
 * Resolve the function first (it's the cheaper, more specific lookup); if there
 * is one, show its signature + body, otherwise fall back to the struct/enum
 * definition.
 */
function DefinitionPanel({
  packageId,
  module,
  name,
}: {
  packageId: string
  module: string
  name: string
}) {
  const { network } = useNetwork()
  const fn = useAsync(
    (signal) => fetchFunctionSignature(network, packageId, module, name, signal),
    [network, packageId, module, name],
  )

  if (fn.loading) {
    return (
      <Panel>
        <PanelSection label="Definition">
          <SkeletonLines count={3} />
        </PanelSection>
      </Panel>
    )
  }
  if (fn.data) {
    return (
      <FunctionDefinitionPanel packageId={packageId} module={module} def={fn.data} />
    )
  }
  return <TypeDefinitionPanel packageId={packageId} module={module} name={name} />
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

  // Only a struct with the `key` ability can exist as a standalone object, so
  // the "objects of this type" list is shown for those alone.
  const isObject = !!data?.abilities.some((a) => a.toLowerCase() === 'key')

  return (
    <>
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

      {isObject && (
        <TypeObjects packageId={packageId} module={module} name={name} />
      )}
    </>
  )
}
