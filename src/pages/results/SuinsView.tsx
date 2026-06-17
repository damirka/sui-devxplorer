import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { resolveSuinsName, atName } from '@/lib/suins'
import { ResultHeader } from './ResultHeader'
import { ObjectView } from './ObjectView'

/**
 * Resolve a SuiNS name (`@handle` / `handle.sui`) to its target address, then
 * render that address through `ObjectView` — carrying the name through as an
 * alias so the resolved page shows what it was reached by.
 */
export function SuinsView({ value }: { value: string }) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => resolveSuinsName(network, value, signal),
    [network, value],
  )

  if (data) return <ObjectView value={data.address} alias={data.domain} />

  return (
    <div>
      <ResultHeader kind="suins" label="SuiNS" value={atName(value)} />

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
          no SuiNS record with a target address for {atName(value)} on the
          selected network.
        </EmptyState>
      )}
    </div>
  )
}
