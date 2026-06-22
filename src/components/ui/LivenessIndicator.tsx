import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { endpointFor } from '@/lib/graphql'
import { useSearchHref } from './links'
import { useNetwork } from '@/context/useNetwork'

// A heartbeat for the active GraphQL endpoint: poll its latest checkpoint, blink
// green each time the sequence advances, and go red when none has advanced for
// more than `STALE_MS` (a dead endpoint OR a stalled chain both read the same
// way to a user — "not making progress").
const POLL_MS = 2_000
const STALE_MS = 5_000
const REQUEST_TIMEOUT_MS = 4_000
const CHECKPOINT_QUERY = '{ checkpoint { sequenceNumber } }'

type Status = 'connecting' | 'live' | 'down'

/**
 * Checkpoint liveness dot for the top bar. Steady dim green between checkpoints,
 * flashing bright on each new one (a visible pulse ≈ every `POLL_MS`); turns red
 * once `STALE_MS` passes with no advance. Polling pauses while the tab is hidden
 * (and hidden time isn't counted as downtime, so refocusing doesn't false-red).
 */
export function LivenessIndicator() {
  const { network, customEndpoint } = useNetwork()
  const searchHref = useSearchHref()
  const [seq, setSeq] = useState<number | null>(null)
  // Bumps on each checkpoint advance — re-keys the ping ring so it replays.
  const [pulse, setPulse] = useState(0)
  // A 1s ticker so staleness flips to red even when requests hang (no response
  // to re-render on); read in render to evaluate `now − lastAdvance`.
  const [now, setNow] = useState(() => Date.now())

  const lastAdvanceRef = useRef(Date.now())
  const seqRef = useRef<number | null>(null)

  // Reset when the endpoint changes (network switch or a new custom URL).
  useEffect(() => {
    seqRef.current = null
    lastAdvanceRef.current = Date.now()
    setSeq(null)
    setNow(Date.now())
  }, [network, customEndpoint])

  // Poll loop: self-scheduling so a slow request never overlaps the next.
  useEffect(() => {
    let active = true
    let timer: number | undefined

    const poll = async () => {
      if (!active) return
      // Don't hammer the endpoint while backgrounded; the visibility handler
      // resets the clock on return so this gap isn't read as downtime.
      if (typeof document !== 'undefined' && document.hidden) {
        timer = window.setTimeout(poll, POLL_MS)
        return
      }
      const controller = new AbortController()
      const to = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(endpointFor(network), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: CHECKPOINT_QUERY }),
          signal: controller.signal,
        })
        const body = (await res.json()) as {
          data?: { checkpoint?: { sequenceNumber?: number | string } | null }
        }
        const n = Number(body?.data?.checkpoint?.sequenceNumber)
        if (
          active &&
          Number.isFinite(n) &&
          (seqRef.current == null || n > seqRef.current)
        ) {
          seqRef.current = n
          lastAdvanceRef.current = Date.now()
          setSeq(n)
          setPulse((p) => p + 1)
        }
      } catch {
        // Swallowed — the staleness watchdog drives the red state.
      } finally {
        window.clearTimeout(to)
        if (active) timer = window.setTimeout(poll, POLL_MS)
      }
    }

    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [network, customEndpoint])

  // Watchdog tick (drives the red transition) + refocus reset.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    const onVisible = () => {
      if (!document.hidden) {
        lastAdvanceRef.current = Date.now()
        setNow(Date.now())
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const sinceAdvance = now - lastAdvanceRef.current
  const status: Status =
    sinceAdvance > STALE_MS ? 'down' : seq == null ? 'connecting' : 'live'

  const title =
    status === 'down'
      ? `${network}: no new checkpoint in ${Math.round(sinceAdvance / 1000)}s — endpoint may be down`
      : status === 'connecting'
        ? `${network}: connecting…`
        : `${network}: live · checkpoint ${seq?.toLocaleString('en-US')}`

  const label = status === 'down' ? 'stall' : status === 'connecting' ? 'sync' : 'live'
  const dotColor =
    status === 'down' ? 'bg-danger' : status === 'connecting' ? 'bg-muted' : 'bg-secondary'
  const textColor =
    status === 'down' ? 'text-danger' : status === 'connecting' ? 'text-muted' : 'text-secondary'

  return (
    <Link
      to={searchHref('checkpoints')}
      role="status"
      aria-label={`${title} — view checkpoints`}
      title={`${title} — click for checkpoints`}
      className="hover:bg-surface-2 inline-flex shrink-0 items-center gap-1.5 px-1.5 py-1 font-mono text-xs transition-colors"
    >
      <span className="relative inline-flex size-2 items-center justify-center">
        {status === 'live' && (
          // Re-keyed on each checkpoint so the expanding ring replays = the blink.
          <span
            key={pulse}
            className="bg-secondary absolute inset-0 rounded-full animate-[liveping_900ms_ease-out_forwards]"
          />
        )}
        <span
          className={cn(
            'relative size-2 rounded-full',
            dotColor,
            status === 'down' && 'animate-pulse',
          )}
        />
      </span>
      <span className={cn('tracking-wide', textColor)}>{label}</span>
    </Link>
  )
}
