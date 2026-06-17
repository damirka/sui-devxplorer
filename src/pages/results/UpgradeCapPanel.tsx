import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { LinkedHash, EntityLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { reverseResolveMvr } from '@/lib/mvr'
import { policyLabel, type UpgradeCapData } from '@/lib/upgradeCap'

export { upgradeCapData } from '@/lib/upgradeCap'

/**
 * Decoded view of an `0x2::package::UpgradeCap` — the capability object that
 * authorizes upgrades of a package. Surfaces the managed package (linked, with
 * its MVR name when one is registered via reverse resolution), the package's
 * current version, and the upgrade policy the cap enforces.
 */
export function UpgradeCapPanel({ cap }: { cap: UpgradeCapData }) {
  const { network } = useNetwork()
  // Reverse-resolve the managed package's MVR name (best-effort, non-blocking —
  // only packages whose owner registered a reverse mapping resolve).
  const { data: mvrName } = useAsync(
    (signal) =>
      cap.package
        ? reverseResolveMvr(network, cap.package, signal)
        : Promise.resolve(null),
    [network, cap.package],
  )

  return (
    <Panel>
      <PanelSection label="UpgradeCap">
        <FieldGrid cols={3}>
          <Field label="Managed package">
            {cap.package ? (
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {mvrName && <EntityLink id={mvrName} />}
                <LinkedHash value={cap.package} />
              </span>
            ) : (
              <Muted>—</Muted>
            )}
          </Field>
          <Field label="Package version">
            <span className="font-mono text-sm">{cap.version ?? '—'}</span>
          </Field>
          <Field label="Upgrade policy">
            {cap.policy != null ? (
              <span className="font-mono text-sm">
                {policyLabel(cap.policy)}{' '}
                <span className="text-muted">({cap.policy})</span>
              </span>
            ) : (
              <Muted>—</Muted>
            )}
          </Field>
        </FieldGrid>
      </PanelSection>
    </Panel>
  )
}
