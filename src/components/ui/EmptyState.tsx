import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="border-line flex flex-col items-center justify-center gap-3 border border-dashed px-6 py-16 text-center">
      {icon && <div className="text-muted/70">{icon}</div>}
      <h2 className="text-text font-mono text-sm font-semibold tracking-[0.18em] uppercase">
        {title}
      </h2>
      {children && (
        <p className="text-muted max-w-md font-mono text-xs leading-relaxed">
          {children}
        </p>
      )}
    </div>
  )
}
