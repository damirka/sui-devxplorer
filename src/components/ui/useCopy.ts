import { useCallback, useState } from 'react'

/**
 * Copy text to the clipboard and flash a brief `copied` confirmation (1.2s) —
 * the shared mechanism behind every copy affordance (icon `CopyButton`, labeled
 * `CopyJsonButton`). Returns the live `copied` flag and a `copy(text)` action.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }, [])
  return { copied, copy }
}
