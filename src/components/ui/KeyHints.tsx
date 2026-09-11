/** A row of `kbd label` pairs — the key legend in a popup's footer. */
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
