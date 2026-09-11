import { useCallback, useRef, useState } from 'react'

/**
 * Copy text to the clipboard and flash a brief `copied` confirmation (1.2s) —
 * the shared mechanism behind every copy affordance (icon `CopyButton`, labeled
 * `CopyJsonButton`, the bookmarks list's `copy id`). Returns the live `copied`
 * flag, the value just copied (for a "copied 0x…" readout) and a `copy(text)`
 * action. A rejected write (no permission, insecure context) flashes nothing.
 */
export function useCopy(): {
  copied: boolean
  copiedValue: string | null
  copy: (text: string) => void
} {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const timer = useRef<number>()
  const copy = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedValue(text)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopiedValue(null), 1200)
      })
      .catch(() => {
        // Clipboard unavailable — nothing to confirm.
      })
  }, [])
  return { copied: copiedValue !== null, copiedValue, copy }
}
