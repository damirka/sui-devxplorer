import { Panel, PanelSection } from '@/components/ui/Panel'
import { EntityLink } from '@/components/ui/links'
import { atName } from '@/lib/suins'

/**
 * The address's default (primary) SuiNS name — the one `defaultNameRecord`
 * assigns it. The GraphQL schema exposes only this single assigned name (no
 * connection for the full set), so the panel shows just the default. Renders
 * nothing when the address has no default name. Links by `@handle` back to its
 * forward resolution. `domain` is the reverse lookup already done by the
 * caller, so this stays a pure presentational panel (no extra request).
 */
export function SuinsNames({ domain }: { domain: string | null }) {
  if (!domain) return null
  return (
    <Panel>
      <PanelSection label="SuiNS name">
        <div className="flex items-center gap-2 font-mono text-xs">
          <EntityLink id={atName(domain)} />
          <span className="text-muted">· primary</span>
        </div>
      </PanelSection>
    </Panel>
  )
}
