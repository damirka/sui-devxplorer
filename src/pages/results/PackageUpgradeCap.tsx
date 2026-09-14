import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, Muted } from '@/components/ui/Field'
import { LinkedHash } from '@/components/ui/links'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchPackageUpgradeCap, describeOwner } from '@/lib/object'
import { fetchObjectRemovalTx } from '@/lib/transaction'
import { policyLabel } from '@/lib/upgradeCap'

/**
 * Who can upgrade this package — its `0x2::package::UpgradeCap` and the account
 * that currently holds it. The cap is found via the package's publish tx (see
 * `fetchPackageUpgradeCap`); its owner is read live, since it's usually
 * transferred away from the original publisher. Renders nothing for packages
 * with no discoverable cap (e.g. system packages). A cap that's no longer a
 * live object was either burned (the package is immutable for good) or
 * wrapped inside a governing object (upgrades go through it — a DAO, a quorum
 * vote). Two ways to tell: the removal probe, while the removing tx is still
 * in the index; and, past that, the upgrade evidence — a package upgraded
 * since the cap's last stored state can only have been upgraded from inside a
 * wrapper (`wrappedProof`). Only a gone cap with no upgrade since is left open.
 */
export function PackageUpgradeCap({ packageId }: { packageId: string }) {
  const { network } = useNetwork()
  const { data, loading } = useAsync(
    (signal) => fetchPackageUpgradeCap(network, packageId, signal),
    [network, packageId],
  )
  // For a gone cap without upgrade evidence: ask the removing tx (if indexed).
  const goneCapId = data && !data.exists && !data.wrappedProof ? data.capId : null
  const removal = useAsync(
    (signal) => (goneCapId ? fetchObjectRemovalTx(network, goneCapId, signal) : Promise.resolve(null)),
    [network, goneCapId],
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
                {data.wrappedProof ? (
                  <span
                    title={`the package was upgraded from v${data.wrappedProof.from} to v${data.wrappedProof.to} after the cap was last seen as a standalone object — upgrades need the cap, so they went through the object it's wrapped in`}
                  >
                    wrapped — another object holds the upgrade right
                  </span>
                ) : removal.loading ? (
                  <span className="text-muted">gone — checking how…</span>
                ) : removal.data?.deleted ? (
                  'burned — package is immutable'
                ) : removal.data ? (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5">
                    wrapped — another object holds the upgrade right
                    <span className="text-muted">·</span>
                    <LinkedHash value={removal.data.digest} />
                  </span>
                ) : (
                  <span
                    title="the cap is no longer a live object: either deleted (burned — the package is immutable) or wrapped inside a governing object. the removing transaction has aged out of the index and the package hasn't been upgraded since, so chain data can't tell which"
                  >
                    deleted or wrapped
                  </span>
                )}
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
