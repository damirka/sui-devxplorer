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
      <span className="inline-flex items-center">
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
