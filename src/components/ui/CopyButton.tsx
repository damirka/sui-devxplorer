import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCopy } from './useCopy'

export function CopyButton({
  value,
  className,
  label = 'Copy',
}: {
  value: string
  className?: string
  label?: string
}) {
  const { copied, copy } = useCopy()

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted hover:text-primary inline-flex items-center transition-colors',
        className,
      )}
    >
      {copied ? (
        <Check size={14} className="text-secondary" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  )
}
