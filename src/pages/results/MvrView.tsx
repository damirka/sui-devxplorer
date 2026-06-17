import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { resolveMvrName, mvrSupported } from '@/lib/mvr'
import { normalizeSuiId } from '@/lib/search'
import { ResultHeader } from './ResultHeader'
import { ObjectView } from './ObjectView'

/**
 * Resolve a Move Registry name (`@namespace/app`, optionally `@ns/app/3`) to
 * its package id, then render that package through `ObjectView` — which shows
 * the name, metadata, and version list via the shared `MvrPanel`. Mirrors how
 * `SuinsView` delegates a resolved name to the object view.
 */
export function MvrView({ value }: { value: string }) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => resolveMvrName(network, value, signal),
    [network, value],
  )

  if (data)
    return (
      <ObjectView
        value={normalizeSuiId(data.replace(/^0x/i, ''))}
        mvrName={value}
      />
    )

  return (
    <div>
      <ResultHeader kind="mvr" label="Move Registry" value={value} />

      {loading && (
        <Panel>
          <PanelSection>
            <SkeletonLines count={4} />
          </PanelSection>
        </Panel>
      )}

      {error && (
        <EmptyState title="failed to resolve name">{error.message}</EmptyState>
      )}

      {!loading && !error && !data && (
        <EmptyState title="name not found">
          {mvrSupported(network)
            ? `no Move Registry package for ${value} on the selected network.`
            : `the Move Registry is not available on ${network}.`}
        </EmptyState>
      )}
    </div>
  )
}
