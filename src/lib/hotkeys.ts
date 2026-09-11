import { useEffect, useRef } from 'react'

/**
 * Shared bits for the site's keyboard layer: the guard every bare-letter hotkey
 * must apply, the platform modifier for key hints, and the cheatsheet data —
 * one table that the `?` popup renders, so a new hotkey is documented by
 * adding a row here.
 */

/** Is the key event aimed at a text field — i.e. a bare letter is typing, not a
 *  shortcut? Every global single-key hotkey bails on this. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * The letter of a shifted-letter keystroke (`B`), uppercase — or `null`. A real
 * keyboard reports the shifted key itself (`B`); some automation reports `b` +
 * shiftKey. Both count. Any other modifier disqualifies.
 */
export function shiftedLetter(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null
  const k = e.key
  if (k >= 'A' && k <= 'Z') return k
  if (e.shiftKey && k >= 'a' && k <= 'z') return k.toUpperCase()
  return null
}

/**
 * Subscribe `handler` to `keydown` on the document for the component's
 * lifetime. The latest render's handler is the one called, so callers pass no
 * dependency list and never re-subscribe.
 */
export function useKeydown(handler: (e: KeyboardEvent) => void): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => latest.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/** Step a menu cursor by `delta` over `n` rows, wrapping at both ends. */
export function cycle(i: number, delta: number, n: number): number {
  return n ? (((i + delta) % n) + n) % n : 0
}

// ─── the gate ───────────────────────────────────────────────────────────────

let openModals = 0

/** Called by `Modal` while it is open; returns the matching release. Any open
 *  modal suspends every bare global hotkey, so keys can't stack popups or act
 *  on the page underneath. */
export function registerOpenModal(): () => void {
  openModals++
  return () => {
    openModals--
  }
}

export function isModalOpen(): boolean {
  return openModals > 0
}

/**
 * The one check every global hotkey runs first: not a key repeat, on a
 * desktop viewport, no popup open, and not typing in a field. A hotkey that
 * must work *inside* its own popup (the cheatsheet's `?` toggle) handles that
 * case before asking.
 */
export function hotkeyAllowed(e: KeyboardEvent): boolean {
  return !e.repeat && isDesktop() && !isModalOpen() && !isEditableTarget(e.target)
}

/** Tailwind's `sm` breakpoint. The keyboard layer is desktop-only — below it
 *  there's no keyboard to press these with, so hotkeys and the `?` entry point
 *  stay off. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
}

/** The platform's primary modifier, for key hints (`⌘z` / `ctrl+z`). */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⌘'
    : 'ctrl+'

export interface HotkeyRow {
  /** Each entry renders as its own `kbd`; several entries = alternatives. */
  keys: string[]
  does: string
}

export interface HotkeySection {
  title: string
  rows: HotkeyRow[]
}

/** Everything the keyboard can do here, grouped by where it applies. */
export const HOTKEYS: HotkeySection[] = [
  {
    title: 'anywhere',
    rows: [
      { keys: ['/', 'tab'], does: 'focus the search' },
      { keys: ['b'], does: 'bookmark this page' },
      { keys: ['B'], does: 'open bookmarks' },
      { keys: ['M', 'T', 'D'], does: 'switch to mainnet / testnet / devnet' },
      { keys: ['?'], does: 'open / close this cheatsheet' },
      { keys: ['esc'], does: 'close a popup' },
    ],
  },
  {
    title: 'search box',
    rows: [
      { keys: ['↵'], does: 'search' },
      { keys: ['↑', '↓'], does: 'pick a hint' },
      { keys: ['esc'], does: 'clear and leave the box' },
      { keys: ['ctrl+u'], does: 'clear the line' },
      { keys: ['ctrl+w', '⌥⌫'], does: 'delete the word before the cursor' },
      { keys: ['⌥←', '⌥→'], does: 'jump by word' },
    ],
  },
  {
    title: 'bookmarks',
    rows: [
      { keys: ['↑', '↓', 'ctrl+n', 'ctrl+p'], does: 'move' },
      { keys: ['↵'], does: 'open' },
      { keys: ['tab'], does: 'actions for the row, then o / r / d / c' },
      { keys: ['⌫'], does: 'delete the row (with an empty filter)' },
      { keys: [`${MOD_KEY}z`], does: 'undo the last delete' },
      { keys: ['esc'], does: 'leave the actions, then close' },
    ],
  },
  {
    title: 'bookmark popup',
    rows: [
      { keys: ['↵'], does: 'save' },
      { keys: ['esc'], does: 'cancel' },
    ],
  },
]
