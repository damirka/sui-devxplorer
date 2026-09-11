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

/** A row of `kbd label` pairs — the footer legend of the bookmark popups. */
export function KeyHints({ items }: { items: (readonly [string, string])[] }) {
  return (
    <span className="text-muted inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
      {items.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <kbd className="kbd">{key}</kbd>
          {label}
        </span>
      ))}
    </span>
  )
}
