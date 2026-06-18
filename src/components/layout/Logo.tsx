import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'group inline-flex items-center gap-1.5 font-mono font-semibold tracking-tight',
        className,
      )}
    >
      <span className="text-primary select-none">❯</span>
      {/* Wordmark collapses to just the `❯` glyph on narrow screens so the
          header's inline search has room. */}
      <span className="hidden items-center sm:inline-flex">
        <span className="text-text transition-colors group-hover:text-primary">
          dev
        </span>
        <span className="text-primary">x</span>
        <span className="text-text transition-colors group-hover:text-primary">
          plorer
        </span>
      </span>
    </Link>
  )
}
