import { cn } from '@/lib/cn'

/** A failed-fetch message in the app's danger style. The one place the
 *  `text-danger font-mono text-xs` error line lives, so every list/panel reports
 *  failures identically. Accepts an `Error` or a ready message string. */
export function ErrorText({
  error,
  className,
}: {
  error: Error | string
  className?: string
}) {
  return (
    <span className={cn('text-danger font-mono text-xs', className)}>
      {typeof error === 'string' ? error : error.message}
    </span>
  )
}
