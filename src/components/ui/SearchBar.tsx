import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { detectSearchKind, type SearchKind, type SearchResultKind } from '@/lib/search'
import { withSearch } from './links'
import { cn } from '@/lib/cn'

interface SearchBarProps {
  variant?: 'hero' | 'compact'
  autoFocus?: boolean
  /** Show the hints dropdown while focused (hero only): worked examples that
   *  teach the box's grammar, and a live echo of what the current input
   *  resolves to — surfaced on focus, while typing, and on paste. */
  hints?: boolean
  /** Fired after a typed search runs (the box navigates). Lets a host — e.g. the
   *  mobile search modal — dismiss itself once the query is submitted. */
  onNavigate?: () => void
}

const HERO_TEXT = 'font-mono text-2xl font-medium tracking-tight sm:text-3xl'

/** One worked example per searchable kind — clickable, and highlighted live as
 *  the typed input resolves to that kind. */
const HINTS: { example: string; label: string; kind: SearchKind }[] = [
  { example: '0x5', label: 'object', kind: 'object' },
  { example: '0x2::coin::Coin', label: 'type', kind: 'package' },
  { example: '0x2::balance::send_funds', label: 'function', kind: 'package' },
  { example: '@adeniyi', label: 'suins', kind: 'suins' },
  { example: '@deepbook/core', label: 'mvr', kind: 'mvr' },
  { example: 'CiWfdYkKqsvkxp7DSWhjLjtyosvhea9vS1kPcZnNvghM', label: 'txs', kind: 'transaction' },
  { example: 'checkpoints', label: 'liveness', kind: 'checkpoints' },
  { example: 'validators', label: 'validators', kind: 'validators' },
]

/** Human label for the kind a live input resolves to (drives the echo line). */
const KIND_LABEL: Partial<Record<SearchKind, string>> = {
  object: 'object',
  transaction: 'transaction',
  package: 'move type / function',
  suins: 'suins name',
  mvr: 'mvr name',
  checkpoints: 'network liveness',
  validators: 'validator set',
}

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
export function SearchBar({ variant = 'hero', autoFocus, hints, onNavigate }: SearchBarProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  // Whether the input currently holds a *range* selection (start ≠ end). The
  // hero overlay drops its block caret while a range is selected, so the mirror
  // text lines up exactly with the input's native selection highlight underneath
  // (otherwise the inserted caret's width offsets the two — see the mirror).
  const [hasSelection, setHasSelection] = useState(false)
  // Keyboard-highlighted hint row (−1 = none). Arrow keys move it; Enter opens it.
  const [activeHint, setActiveHint] = useState(-1)
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

  // Track the input's caret index (and whether a range is selected) so the
  // overlaid hero block caret can sit at the real insertion point and step aside
  // while text is selected.
  const updateCaret = useCallback(() => {
    const el = inputRef.current
    const start = el?.selectionStart ?? 0
    const end = el?.selectionEnd ?? start
    setCaret(start)
    setHasSelection(start !== end)
  }, [])

  // Restore the caret after a shortcut-driven value edit (Ctrl+U / Ctrl+W).
  useEffect(() => {
    const p = pendingCaret.current
    if (p != null && inputRef.current) {
      inputRef.current.setSelectionRange(p, p)
      setCaret(p)
      setHasSelection(false)
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

  // Hints dropdown (hero only): shown while focused. Empty → worked examples;
  // typing/paste → a live echo of what the input resolves to, with the matching
  // example highlighted. `detected` is null until there's something to classify.
  const showHints = !!hints && variant === 'hero' && focused
  const detected = trimmed ? detectSearchKind(trimmed) : null
  const hintHref = (example: string) => `?${withSearch(searchParams, example).toString()}`

  // Run a search for `q`: write `?search=` (a shareable link) and reset the box.
  // Shared by the form submit (the typed value) and by opening a hint row.
  const runSearch = useCallback(
    (q: string) => {
      const v = q.trim()
      if (!v) return
      setSearchParams((prev) => withSearch(prev, v))
      setValue('')
      inputRef.current?.blur()
      onNavigate?.()
    },
    [setSearchParams, onNavigate],
  )

  function submit(e: FormEvent) {
    e.preventDefault()
    runSearch(value)
  }

  // Terminal/readline editing shortcuts. Handled explicitly so they work the
  // same across platforms (on Linux/Windows Ctrl+U = view-source and Alt+← =
  // browser-back, so we preventDefault and do the edit ourselves).
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue('')
      setActiveHint(-1)
      inputRef.current?.blur()
      return
    }

    // Arrow-key navigation of the hints dropdown: ↓/↑ move the highlight (cycling
    // through the rows), ↵ opens the highlighted one. With nothing highlighted
    // (the default), ↵ falls through to the form submit of the typed value.
    if (showHints) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveHint((i) => (i + 1) % HINTS.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveHint((i) => (i <= 0 ? HINTS.length - 1 : i - 1))
        return
      }
      if (e.key === 'Enter' && activeHint >= 0) {
        e.preventDefault()
        runSearch(HINTS[activeHint].example)
        return
      }
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
      setHasSelection(false)
      syncScroll()
      return
    }
    if (alt && !e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault()
      const p = nextWordEnd(value, end)
      el.setSelectionRange(p, p)
      setCaret(p)
      setHasSelection(false)
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
      setHasSelection(false) // typing collapses any selection
      setActiveHint(-1) // a new query resets the hint highlight
    },
    onKeyDown,
    // Backstops for caret moves that don't change the value (click, arrows,
    // Home/End, drag-select). When the caret is unchanged these bail out of
    // re-rendering, so they add no cost to the typing path above.
    onKeyUp: updateCaret,
    onSelect: updateCaret,
    onScroll: syncScroll,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      setActiveHint(-1)
    },
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
      <form onSubmit={submit} role="search" className="relative w-full">
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
                  {hasSelection ? (
                    // A range is selected: render the text as-is (no inserted
                    // caret) so it aligns with the native selection highlight
                    // showing through from the transparent input underneath.
                    value
                  ) : (
                    <>
                      {value.slice(0, caret)}
                      <Caret on={focused} />
                      {value.slice(caret)}
                    </>
                  )}
                </span>
              ) : (
                <span className="text-muted">
                  <Caret on={focused} />
                  {/* Full grammar hint on desktop; a short label on mobile, where
                      the long string overruns the viewport at this type size. */}
                  <span className="sm:hidden">search sui network</span>
                  <span className="hidden sm:inline">search pkgs, txs, objects on sui</span>
                </span>
              )}
            </div>

            {/* Input layer: transparent text + native caret hidden */}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              {...sharedInputProps}
              style={{ caretColor: 'transparent', color: 'transparent' }}
              // Keep the *selected* text transparent too: the global
              // `::selection` rule repaints selected text in --text, which would
              // otherwise reveal the input's hidden glyphs on top of the mirror
              // (the doubled, garbled look). The green highlight still shows.
              className={cn(
                'relative w-full bg-transparent outline-none selection:text-transparent',
                HERO_TEXT,
              )}
            />
          </div>

          {affordance}
        </div>

        {showHints && (
          <HintsDropdown
            detected={detected}
            hintHref={hintHref}
            activeHint={activeHint}
            onHover={setActiveHint}
          />
        )}
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

/**
 * The hints popover under the hero prompt. While the box is empty it lists the
 * worked examples (teaching the single box's grammar); once you start typing (or
 * paste), it echoes back the kind the input resolves to and highlights the
 * matching example, dimming the rest — so the grammar lesson turns into live
 * feedback. `onMouseDown`-preventDefault keeps the input focused when a hint is
 * clicked, so the click lands (the navigation) instead of just blurring.
 */
function HintsDropdown({
  detected,
  hintHref,
  activeHint,
  onHover,
}: {
  detected: SearchResultKind | null
  hintHref: (example: string) => string
  /** Keyboard-highlighted row index (−1 = none). */
  activeHint: number
  /** Sync the highlight to the hovered row, so mouse and keyboard agree. */
  onHover: (i: number) => void
}) {
  const label = detected ? KIND_LABEL[detected.kind] : undefined
  return (
    <div
      // Keep the input focused when a row is clicked, so the click lands as a
      // navigation instead of a blur that closes the dropdown first.
      onMouseDown={(e) => e.preventDefault()}
      onMouseLeave={() => onHover(-1)}
      className="border-line bg-surface glow absolute top-full right-0 left-0 z-30 mt-2 border p-4"
      style={{ animation: 'fadeIn 0.12s ease-out' }}
    >
      {detected ? (
        <div className="border-line mb-3 flex items-center justify-between gap-3 border-b pb-3 font-mono text-xs">
          {label ? (
            <span className="text-muted">
              resolves to{' '}
              <span className="text-primary font-bold tracking-wider uppercase">{label}</span>
            </span>
          ) : (
            <span className="text-muted">unrecognised — keep typing</span>
          )}
          <NavKeys />
        </div>
      ) : (
        <div className="border-line mb-3 flex items-center justify-between gap-3 border-b pb-3">
          <span className="panel-label">try</span>
          <NavKeys />
        </div>
      )}

      <div className="flex flex-col font-mono text-xs">
        {HINTS.map((h, i) => {
          const active = i === activeHint
          const match = detected != null && detected.kind === h.kind
          // Dim the rows that don't match the typed input — unless one is
          // actively highlighted (then nothing is dimmed, so the cursor reads
          // clearly as it moves through every row).
          const dim = detected != null && !match && activeHint < 0
          const lit = active || match
          return (
            <Link
              key={h.example}
              to={hintHref(h.example)}
              title={`search ${h.example}`}
              onMouseEnter={() => onHover(i)}
              className={cn(
                '-mx-2 flex items-center justify-between gap-6 px-2 py-1 transition-colors',
                active && 'bg-surface-2',
                dim && 'opacity-40',
              )}
            >
              <span className={cn('min-w-0 break-all', lit ? 'text-primary' : 'text-muted')}>
                {h.example}
              </span>
              <span
                className={cn(
                  'shrink-0 select-none',
                  lit ? 'text-primary' : 'text-muted opacity-60',
                )}
              >
                {h.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/** The ↑ ↓ ↵ affordance shown in the dropdown header — teaches that the rows are
 *  keyboard-navigable. */
function NavKeys() {
  return (
    <span className="text-muted inline-flex items-center gap-1.5">
      <kbd className="kbd">↑</kbd>
      <kbd className="kbd">↓</kbd>
      <kbd className="kbd">↵</kbd>
    </span>
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
