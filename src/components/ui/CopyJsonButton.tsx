import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCopy } from './useCopy'

/** A labeled control that copies a value to the clipboard as pretty-printed JSON.
 *  Flips to a brief `copied` confirmation, matching the app's copy affordances. */
export function CopyJsonButton({
  value,
  label = 'copy json',
  title,
  className,
}: {
  value: unknown
  label?: string
  title?: string
  className?: string
}) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={() => copy(JSON.stringify(value, null, 2))}
      title={title}
      className={cn(
        'text-muted hover:text-primary inline-flex items-center gap-1.5 font-mono text-[0.7rem] transition-colors',
        className,
      )}
    >
      {copied ? <Check size={12} className="text-secondary" /> : <Copy size={12} />}
      {copied ? 'copied' : label}
    </button>
  )
}
