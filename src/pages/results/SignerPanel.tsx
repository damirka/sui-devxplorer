import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Hash } from '@/components/ui/Hash'
import { Badge } from '@/components/ui/Badge'
import { RowIndex } from '@/components/ui/RowIndex'
import { Field } from '@/components/ui/Field'
import type { MultisigInfo, SignerScheme } from '@/lib/transaction'

/**
 * How an address authenticates, recovered from a transaction it signed. Sui
 * addresses carry no on-chain scheme marker (see `fetchSignerScheme`), so this
 * renders only once such a tx is found — `info` is null for receive-only
 * addresses — and shows whatever the scheme exposes: a public key (single-key
 * schemes + passkey), a multisig committee, the zkLogin proof epoch, or a
 * passkey origin. Mount it unconditionally; it returns null when there's
 * nothing to show.
 */
export function SignerPanel({ info }: { info: SignerScheme | null }) {
  if (!info) return null
  const { scheme, publicKey, multisig, maxEpoch, passkeyOrigin } = info

  return (
    <Panel>
      <PanelSection label="Signer" action={<Badge tone="muted">{scheme}</Badge>}>
        <div className="space-y-4">
          {publicKey && (
            <Field label="public key" inline>
              <Hash value={publicKey} className="text-xs" />
            </Field>
          )}
          {maxEpoch != null && (
            <Field label="max epoch" inline>
              <span className="font-mono text-xs">{maxEpoch}</span>
            </Field>
          )}
          {passkeyOrigin && (
            <Field label="origin" inline>
              <span className="font-mono text-xs break-all">{passkeyOrigin}</span>
            </Field>
          )}
          {multisig && <Committee info={multisig} />}
        </div>
      </PanelSection>
    </Panel>
  )
}

/**
 * The multisig committee: its M-of-N threshold (always shown) over a collapsible
 * list of member keys + weights. The members — the actual signers — are hidden
 * by default; a multisig can have many, and the threshold summary is the bit you
 * usually want at a glance.
 */
function Committee({ info }: { info: MultisigInfo }) {
  const [open, setOpen] = useState(false)
  const totalWeight = info.members.reduce((sum, m) => sum + m.weight, 0)
  const count = info.members.length

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'hide signers' : 'show signers'}
        className="hover:text-primary flex w-full items-center gap-2.5 transition-colors"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
        <span className="panel-label">committee</span>
        <span className="text-muted font-mono text-xs" title="weight required of total">
          threshold {info.threshold} / {totalWeight}
        </span>
        <span className="text-muted font-mono text-xs">
          · {count} {count === 1 ? 'signer' : 'signers'}
        </span>
      </button>
      {open && (
        <ul className="divide-line divide-y font-mono text-xs">
          {info.members.map((m, i) => (
            <li
              key={`${m.publicKey ?? m.scheme}-${i}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <RowIndex n={i + 1} />
              <Badge tone="muted">{m.scheme}</Badge>
              {m.publicKey ? (
                <Hash value={m.publicKey} className="min-w-0 flex-1" />
              ) : (
                <span className="text-muted flex-1">—</span>
              )}
              <span className="text-muted shrink-0" title="vote weight">
                weight {m.weight}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
