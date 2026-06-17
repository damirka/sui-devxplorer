import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchObject } from '@/lib/object'
import { normalizeSuiId } from '@/lib/search'
import { ResultHeader } from './ResultHeader'
import { PackageBody } from './PackageBody'

/**
 * Package view for a qualified path — `addr::module` or `addr::module::Type`
 * (what a `TypeLink` navigates to). We resolve the package at `addr` and render
 * the shared `PackageBody`, opening the referenced module by default. A bare
 * package id instead routes through `ObjectView`, which delegates to the same
 * body once it sees `asMovePackage`.
 */
export function PackageView({ value }: { value: string }) {
  const { network } = useNetwork()
  // `addr::module::Type` (or `addr::module`). Strip any trailing generics from
  // the type — only the top-level tag is used to locate the declaration.
  const [addr, moduleName, typeName] = value.split('::')
  const packageId = normalizeSuiId(addr.replace(/^0x/i, '').toLowerCase())
  const highlightType = typeName?.split('<')[0]

  const { data, loading, error } = useAsync(
    (signal) => fetchObject(network, packageId, signal),
    [network, packageId],
  )

  const object = data?.object ?? null
  const isPackage = !!object?.asMovePackage

  return (
    <div>
      <ResultHeader
        kind="package"
        label="Package"
        value={value}
        meta={<LinkedHash value={packageId} />}
      />

      {loading && (
        <Panel>
          <PanelSection>
            <SkeletonLines count={6} />
          </PanelSection>
        </Panel>
      )}

      {error && (
        <EmptyState title="failed to load package">{error.message}</EmptyState>
      )}

      {!loading && !error && object && !isPackage && (
        <EmptyState title="not a package">
          the id in this path resolves to an object, not a package.
        </EmptyState>
      )}

      {!loading && !error && data && !object && (
        <EmptyState title="package not found">
          no package exists at this id on the selected network.
        </EmptyState>
      )}

      {object && isPackage && (
        <PackageBody
          data={object}
          defaultModule={moduleName}
          highlightType={highlightType}
        />
      )}
    </div>
  )
}
