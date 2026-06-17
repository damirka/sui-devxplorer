import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { LinkedHash, EntityLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { reverseResolveMvr } from '@/lib/mvr'
import { normalizeSuiId } from '@/lib/search'

/** The canonical `0x2` framework id, padded — system reprs use the full form. */
const FRAMEWORK_ID = normalizeSuiId('2')

export interface UpgradeCapData {
  /** The package id this cap authorizes upgrades of (its original/defining id). */
  package: string | null
  /** The on-chain version the package is currently at. */
  version: string | null
  /** The upgrade-policy byte (0 / 128 / 192). */
  policy: number | null
}

/**
 * Whether a Move type repr is `0x2::package::UpgradeCap`. The address is
 * normalized first, so it matches whether the repr writes it short (`0x2`) or
 * fully padded (`0x000…0002`, the form GraphQL returns for framework types).
 */
function isUpgradeCapType(repr: string | null): boolean {
  if (!repr) return false
  const parts = repr.split('::')
  if (parts.length !== 3) return false
  const [addr, mod, name] = parts
  if (mod !== 'package' || name !== 'UpgradeCap') return false
  return normalizeSuiId(addr.replace(/^0x/i, '').toLowerCase()) === FRAMEWORK_ID
}

/**
 * If `(repr, json)` describe an `0x2::package::UpgradeCap`, pull its
 * package / version / policy fields out of the contents JSON; otherwise `null`.
 * Lets the object view decide whether to render the decoded panel.
 */
export function upgradeCapData(
  repr: string | null,
  json: unknown,
): UpgradeCapData | null {
  if (!isUpgradeCapType(repr)) return null
  const f = (json ?? {}) as Record<string, unknown>
  const pkg = typeof f.package === 'string' ? f.package : null
  const version =
    typeof f.version === 'string'
      ? f.version
      : typeof f.version === 'number'
        ? String(f.version)
        : null
  const policy =
    typeof f.policy === 'number'
      ? f.policy
      : typeof f.policy === 'string' && f.policy.trim() !== ''
        ? Number(f.policy)
        : null
  return { package: pkg, version, policy }
}

/** Sui's upgrade-policy bytes (`0x2::package`): how permissive future upgrades
 * may be. Higher = more restrictive; `255` is set when made immutable. */
function policyLabel(policy: number): string {
  switch (policy) {
    case 0:
      return 'compatible'
    case 128:
      return 'additive'
    case 192:
      return 'dependency-only'
    default:
      return 'restricted'
  }
}

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
