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
  const [caret, setCaret] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  // Caret to restore after a shortcut that edits the value (applied once the
  // controlled re-render commits — see effect below).
  const pendingCaret = useRef<number | null>(null)

  // Keep the overlaid caret/text aligned with the input's native scroll.
  const syncScroll = useCallback(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.style.transform = `translateX(${-inputRef.current.scrollLeft}px)`
    }
  }, [])
  useEffect(syncScroll, [value, syncScroll])

  // Track the input's caret index so the overlaid hero block caret can sit at
  // the real insertion point (and move as you type / navigate).
  const updateCaret = useCallback(() => {
    setCaret(inputRef.current?.selectionStart ?? 0)
  }, [])

  // Restore the caret after a shortcut-driven value edit (Ctrl+U / Ctrl+W).
  useEffect(() => {
    const p = pendingCaret.current
    if (p != null && inputRef.current) {
      inputRef.current.setSelectionRange(p, p)
      setCaret(p)
      pendingCaret.current = null
      syncScroll()
    }
  }, [value, syncScroll])

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
      params.delete('version') // a new search is a fresh entity — drop any version pin
      return params
    })
    setValue('')
    inputRef.current?.blur()
  }

  // Terminal/readline editing shortcuts. Handled explicitly so they work the
  // same across platforms (on Linux/Windows Ctrl+U = view-source and Alt+← =
  // browser-back, so we preventDefault and do the edit ourselves).
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue('')
      inputRef.current?.blur()
      return
    }

    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const ctrl = e.ctrlKey && !e.metaKey // Ctrl, not Cmd
    const alt = e.altKey && !e.metaKey // Alt / Option

    // Ctrl+U — clear the line.
    if (ctrl && !alt && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      setValue('')
      pendingCaret.current = 0
      return
    }

    // Ctrl+W / Alt+Backspace — delete the word before the cursor (or the
    // current selection, if any).
    if ((ctrl && !alt && e.key.toLowerCase() === 'w') || (alt && e.key === 'Backspace')) {
      e.preventDefault()
      const from = start === end ? prevWordStart(value, start) : start
      setValue(value.slice(0, from) + value.slice(end))
      pendingCaret.current = from
      return
    }

    // Alt/Option+← / → — move by word.
    if (alt && !e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault()
      const p = prevWordStart(value, start)
      el.setSelectionRange(p, p)
      setCaret(p)
      syncScroll()
      return
    }
    if (alt && !e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault()
      const p = nextWordEnd(value, end)
      el.setSelectionRange(p, p)
      setCaret(p)
      syncScroll()
      return
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
    // Update value AND caret together: both setState calls are batched into a
    // single render, so the overlaid block caret lands at the new insertion
    // point on the same frame as the typed text. Tracking the caret separately
    // (via onKeyUp/onSelect only) left it a render behind while typing, which
    // read as a laggy, trailing cursor.
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.currentTarget
      setValue(el.value)
      setCaret(el.selectionStart ?? el.value.length)
    },
    onKeyDown,
    // Backstops for caret moves that don't change the value (click, arrows,
    // Home/End, drag-select). When the caret is unchanged these bail out of
    // re-rendering, so they add no cost to the typing path above.
    onKeyUp: updateCaret,
    onSelect: updateCaret,
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

          <div className="relative min-w-0 flex-1 overflow-hidden">
            {/* Visible layer: typed text with the block caret rendered at the
                cursor position (the input's own caret is transparent), or the
                placeholder — caret first — when empty. */}
            <div
              ref={mirrorRef}
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center whitespace-pre',
                HERO_TEXT,
              )}
            >
              {value ? (
                <span className="text-text">
                  {value.slice(0, caret)}
                  <Caret on={focused} />
                  {value.slice(caret)}
                </span>
              ) : (
                <span className="text-muted">
                  <Caret on={focused} />
                  search pkgs, txs, objects on sui
                </span>
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
        placeholder="search pkgs, txs, objects on sui"
        className="input py-2.5 pr-12 pl-9 text-sm"
      />
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
        {affordance}
      </div>
    </form>
  )
}

/** The chunky terminal block caret, sized to the text and aligned to it.
 * Blinks while focused; hidden (but space-preserving) when not. */
function Caret({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'term-caret align-middle',
        on ? 'term-caret-blink' : 'opacity-0',
      )}
    />
  )
}

/** Index of the start of the word before `pos`: skip separators, then word
 * chars. Word = `[A-Za-z0-9_]`, so `::` / `<>` / `0x` act as boundaries — handy
 * for stepping through `addr::module::Struct`. */
function prevWordStart(v: string, pos: number): number {
  let i = pos
  while (i > 0 && !/\w/.test(v[i - 1])) i--
  while (i > 0 && /\w/.test(v[i - 1])) i--
  return i
}

/** Index just past the end of the word at/after `pos`. */
function nextWordEnd(v: string, pos: number): number {
  let i = pos
  while (i < v.length && !/\w/.test(v[i])) i++
  while (i < v.length && /\w/.test(v[i])) i++
  return i
}
