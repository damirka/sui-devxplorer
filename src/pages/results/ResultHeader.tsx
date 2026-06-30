import type { ReactNode } from 'react'
import { Badge, BadgeRow } from '@/components/ui/Badge'
import { Hash } from '@/components/ui/Hash'
import type { SearchKind } from '@/lib/search'

/**
 * Shared masthead for every result view: type tag, the id in a terminal strip
 * (`❯ 0x… [copy]`), plus any extra meta (status, resolved name, package id).
 */
export function ResultHeader({
  kind,
  label,
  value,
  meta,
}: {
  kind: SearchKind
  label: string
  value: string
  meta?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <BadgeRow>
        <Badge kind={kind}>{label}</Badge>
        {meta}
      </BadgeRow>
      <div className="border-line bg-surface flex items-center gap-2.5 border px-3 py-2.5">
        <span aria-hidden className="text-primary shrink-0 select-none">
          ❯
        </span>
        <Hash value={value} full className="min-w-0 flex-1 text-sm break-all sm:text-base" />
      </div>
    </div>
  )
}
