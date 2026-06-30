import { useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * The `live` / interval state behind a {@link LiveControl}, plus the derived
 * `pollMs` for `usePagedList({ pollMs })`. Spread `controlProps` straight into
 * `<LiveControl />`. Keeps the toggle + interval wiring in one place so each
 * live transaction list is just `const { pollMs, controlProps } = useLivePoll()`.
 */
export function useLivePoll() {
  const [live, setLive] = useState(false)
  const [intervalSec, setIntervalSec] = useState(1)
  const pollMs = live ? Math.max(1, intervalSec) * 1000 : null
  return {
    pollMs,
    controlProps: {
      live,
      onToggle: () => setLive((v) => !v),
      intervalSec,
      onIntervalChange: setIntervalSec,
    },
  }
}

/**
 * Auto-refresh control shared by the transaction lists: a `live` toggle (pulsing
 * when on) plus the poll interval in seconds. While live, the owning list polls
 * and refreshes in place to surface new transactions at the top. Drive it with
 * {@link useLivePoll}, whose `pollMs` feeds the list's `usePagedList`.
 */
export function LiveControl({
  live,
  onToggle,
  intervalSec,
  onIntervalChange,
}: {
  live: boolean
  onToggle: () => void
  intervalSec: number
  onIntervalChange: (sec: number) => void
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={live}
        title={live ? 'stop auto-refresh' : 'auto-refresh to watch for new transactions'}
        className={cn(
          'inline-flex items-center gap-1.5 border px-2 py-1 transition-colors',
          live
            ? 'border-secondary text-secondary'
            : 'border-line text-muted hover:border-primary hover:text-primary',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            live ? 'bg-secondary animate-pulse' : 'bg-muted',
          )}
        />
        live
      </button>
      {live && (
        <label className="text-muted inline-flex items-center gap-1">
          every
          <input
            type="number"
            min={1}
            value={intervalSec}
            onChange={(e) => onIntervalChange(Math.max(1, Number(e.target.value) || 1))}
            aria-label="refresh interval in seconds"
            className="bg-surface border-line w-10 border px-1 py-0.5 text-center"
          />
          s
        </label>
      )}
    </div>
  )
}
