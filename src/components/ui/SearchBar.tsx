import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'

interface SearchBarProps {
  variant?: 'hero' | 'compact'
  autoFocus?: boolean
}

const HERO_TEXT = 'font-mono text-2xl font-medium tracking-tight sm:text-3xl'

/**
 * The single entry point of the app. Submitting writes `?search=` to the URL
 * (preserving other params), which makes every search a shareable link and
 * keeps the back button working.
 *
 * The field is a fresh input for starting a *new* search — it deliberately
 * does NOT mirror the current `?search=`, so it stays empty while you view a
 * result (the result header already shows the active id) and clears on submit.
 *
 * `hero` renders as a large terminal prompt that IS the input, with a custom
 * chunky block caret; `compact` is the boxed field used in the header.
 */
export function SearchBar({ variant = 'hero', autoFocus }: SearchBarProps) {
  const [, setSearchParams] = useSearchParams()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // Keep the overlaid caret/text aligned with the input's native scroll.
  const syncScroll = useCallback(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.style.transform = `translateX(${-inputRef.current.scrollLeft}px)`
    }
  }, [])
  useEffect(syncScroll, [value, syncScroll])

  // Dev muscle memory: `/` or Tab focuses the search from anywhere (unless
  // already typing in a field).
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== '/' && e.key !== 'Tab') return
      const el = inputRef.current
      if (!el || el.offsetParent === null) return // skip hidden instances
      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) {
        return
      }
      e.preventDefault()
      el.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const trimmed = value.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed) return
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('search', trimmed)
      return params
    })
    setValue('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue('')
      inputRef.current?.blur()
    }
  }

  const sharedInputProps = {
    ref: inputRef,
    type: 'text' as const,
    inputMode: 'text' as const,
    autoComplete: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    autoFocus,
    value,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
    onKeyDown,
    onScroll: syncScroll,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    'aria-label': 'Search the Sui network',
  }

  // Live hint on the right: typing → ↵ · idle → press /
  const affordance = trimmed ? (
    <kbd className="kbd hidden sm:inline-flex">↵</kbd>
  ) : !focused ? (
    <kbd className="kbd hidden sm:inline-flex">/</kbd>
  ) : null

  if (variant === 'hero') {
    return (
      <form onSubmit={submit} role="search" className="w-full">
        <div
          className={cn(
            'flex items-center gap-3 border-b pb-3 transition-colors',
            focused ? 'border-[color:rgb(var(--glow)/0.6)]' : 'border-line',
          )}
        >
          <span
            aria-hidden
            className={cn('text-primary shrink-0 select-none', HERO_TEXT)}
          >
            ❯
          </span>

          {/* Caret is pinned here (outside the scrolling text area) so the
              value and the placeholder both start at the same x — no offset. */}
          <span
            aria-hidden
            className={cn(
              'term-caret',
              focused ? 'term-caret-blink' : 'opacity-0',
            )}
          />

          <div className="relative min-w-0 flex-1 overflow-hidden">
            {/* Visible layer: typed text, or placeholder when empty */}
            <div
              ref={mirrorRef}
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center whitespace-pre',
                HERO_TEXT,
              )}
            >
              {value ? (
                <span className="text-text">{value}</span>
              ) : (
                <span className="text-muted">search the chain</span>
              )}
            </div>

            {/* Input layer: transparent text + native caret hidden */}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              {...sharedInputProps}
              style={{ caretColor: 'transparent', color: 'transparent' }}
              className={cn(
                'relative w-full bg-transparent outline-none',
                HERO_TEXT,
              )}
            />
          </div>

          {affordance}
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-md">
      <span
        aria-hidden
        className="text-primary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm select-none"
      >
        ❯
      </span>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        {...sharedInputProps}
        placeholder="search the chain"
        className="input py-2.5 pr-12 pl-9 text-sm"
      />
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
        {affordance}
      </div>
    </form>
  )
}
