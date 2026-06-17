import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, Muted } from '@/components/ui/Field'
import { LinkedHash } from '@/components/ui/links'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchPackageUpgradeCap, describeOwner } from '@/lib/object'
import { policyLabel } from '@/lib/upgradeCap'

/**
 * Who can upgrade this package — its `0x2::package::UpgradeCap` and the account
 * that currently holds it. The cap is found via the package's publish tx (see
 * `fetchPackageUpgradeCap`); its owner is read live, since it's usually
 * transferred away from the original publisher. Renders nothing for packages
 * with no discoverable cap (e.g. system packages). When the cap has been burned,
 * says so — the package is immutable.
 */
export function PackageUpgradeCap({ packageId }: { packageId: string }) {
  const { network } = useNetwork()
  const { data, loading } = useAsync(
    (signal) => fetchPackageUpgradeCap(network, packageId, signal),
    [network, packageId],
  )

  if (loading) {
    return (
      <Panel>
        <PanelSection label="Upgrade authority">
          <SkeletonLines count={1} />
        </PanelSection>
      </Panel>
    )
  }

  // No cap to show (system/genesis package, or unmatched) — stay out of the way.
  if (!data) return null

  const owner = data.exists ? describeOwner(data.owner) : null

  return (
    <Panel>
      <PanelSection label="Upgrade authority">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-3">
          <Field inline label="UpgradeCap">
            <LinkedHash value={data.capId} />
          </Field>

          <Field inline label="Owner">
            {!data.exists ? (
              <span className="font-mono text-sm">
                destroyed — package is immutable
              </span>
            ) : owner?.address ? (
              <span className="flex items-center gap-2">
                <span className="text-muted text-xs">{owner.kind}</span>
                <LinkedHash value={owner.address} />
              </span>
            ) : (
              <span className="font-mono text-sm">{owner?.kind ?? '—'}</span>
            )}
          </Field>

          {data.exists && (
            <Field inline label="Policy">
              {data.policy != null ? (
                <span className="font-mono text-sm">
                  {policyLabel(data.policy)}{' '}
                  <span className="text-muted">({data.policy})</span>
                </span>
              ) : (
                <Muted>—</Muted>
              )}
            </Field>
          )}
        </div>
      </PanelSection>
    </Panel>
  )
}
