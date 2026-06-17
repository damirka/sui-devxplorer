import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'

export function CopyButton({
  value,
  className,
  label = 'Copy',
}: {
  value: string
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }, [value])

  return (
    <button
      type="button"
      onClick={onCopy}
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
