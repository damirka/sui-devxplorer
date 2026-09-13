import { useEffect, type RefObject } from 'react'

/**
 * Bring a deep-linked section to the top of the viewport when a page opens on
 * it (a bookmark, a shared link, the back button after opening a row), and
 * keep it there while the async panels above it are still landing and pushing
 * it down — re-anchoring on every document resize, until the user scrolls on
 * their own or the page has settled for a while. Enable it once the section's
 * own content is ready; a `false` → `true` flip starts the anchoring.
 */
export function useDeepLinkScroll(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let stopped = false
    let settle: ReturnType<typeof setTimeout> | null = null
    const stop = () => {
      stopped = true
      observer.disconnect()
      if (settle) clearTimeout(settle)
      for (const ev of USER_SCROLL_EVENTS) window.removeEventListener(ev, stop)
    }
    const anchor = () => {
      if (stopped) return
      if (Math.abs(el.getBoundingClientRect().top) > 2) el.scrollIntoView({ block: 'start' })
      // Every re-anchor restarts the quiet period; a document that stops
      // moving for this long is done loading. Generous: the panels above are
      // GraphQL round-trips that can take several seconds each.
      if (settle) clearTimeout(settle)
      settle = setTimeout(stop, SETTLE_MS)
    }
    const observer = new ResizeObserver(anchor)
    for (const ev of USER_SCROLL_EVENTS) window.addEventListener(ev, stop, { passive: true })
    anchor()
    observer.observe(document.body)
    return stop
  }, [ref, enabled])
}

/** Evidence the user took over scrolling — stop fighting them. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown'] as const
const SETTLE_MS = 8000
