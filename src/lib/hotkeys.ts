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
