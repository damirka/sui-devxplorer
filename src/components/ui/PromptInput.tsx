import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PromptInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Accessible name — a prompt has no visible label. */
  label: string
  /** Drop the boxed `.input` chrome: a bare line at the top of a panel (the
   *  bookmarks filter). */
  bare?: boolean
  /** Right-edge slot, e.g. a key affordance. */
  trailing?: ReactNode
}

/**
 * The terminal prompt field: a `❯` pinned before a mono text input. The compact
 * header search, the bookmark name field and the bookmarks filter are all this
 * one control; the hero search is not — it overlays its own block caret.
 */
export const PromptInput = forwardRef<HTMLInputElement, PromptInputProps>(function PromptInput(
  { label, bare = false, trailing, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          'text-primary pointer-events-none absolute top-1/2 -translate-y-1/2 font-mono text-sm select-none',
          bare ? 'left-4' : 'left-3',
        )}
      >
        ❯
      </span>
      <input
        ref={ref}
        type="text"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        aria-label={label}
        className={cn(
          bare
            ? 'placeholder:text-muted w-full bg-transparent py-3 pr-4 pl-10 font-mono text-sm outline-none'
            : 'input py-2.5 pl-9 text-sm',
          trailing && 'pr-12',
          className,
        )}
        {...props}
      />
      {trailing && (
        <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
          {trailing}
        </div>
      )}
    </div>
  )
})
