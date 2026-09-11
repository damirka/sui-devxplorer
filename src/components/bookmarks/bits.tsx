import { KIND_TAG } from '@/lib/bookmarks'
import type { SearchKind } from '@/lib/search'

/** Tiny uppercase kind tag for a bookmark line (`TX`, `MOVE`, …). */
export function KindTag({ kind }: { kind: SearchKind }) {
  return (
    <span className="text-muted shrink-0 text-[10px] font-bold tracking-[0.15em] uppercase select-none">
      {KIND_TAG[kind]}
    </span>
  )
}
