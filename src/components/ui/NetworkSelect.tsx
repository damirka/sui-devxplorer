import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useNetwork } from '@/context/useNetwork'
import { NETWORKS } from '@/context/network-context'

/** A usable GraphQL endpoint: a well-formed http(s) URL. */
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function NetworkSelect() {
  const { network, setNetwork, customEndpoint, setCustomEndpoint } = useNetwork()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(customEndpoint)
  const ref = useRef<HTMLDivElement>(null)

  // Seed the input with the saved endpoint each time the menu opens.
  useEffect(() => {
    if (open) setDraft(customEndpoint)
  }, [open, customEndpoint])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const valid = isHttpUrl(draft.trim())

  function applyCustom() {
    if (!valid) return
    setCustomEndpoint(draft.trim()) // also switches the network to `custom`
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={network === 'custom' ? customEndpoint || 'custom graphql url' : undefined}
        className="btn btn-ghost gap-2 font-mono text-xs"
      >
        <span className="bg-primary size-2" />
        {network}
        <ChevronDown
          size={14}
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="panel glow animate-[fadeIn_120ms_ease] absolute right-0 z-50 mt-2 w-72 overflow-hidden p-1">
          <ul role="listbox">
            {NETWORKS.map((n) => (
              <li key={n}>
                <button
                  type="button"
                  role="option"
                  aria-selected={n === network}
                  onClick={() => {
                    setNetwork(n)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs transition-colors',
                    n === network
                      ? 'bg-surface-2 text-primary'
                      : 'text-text hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn('size-2', n === network ? 'bg-primary' : 'bg-muted')}
                  />
                  {n}
                </button>
              </li>
            ))}
          </ul>

          {/* Custom GraphQL endpoint — e.g. a local node or a private indexer. */}
          <div className="border-line mt-1 border-t px-3 pt-2.5 pb-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={cn(
                  'size-2',
                  network === 'custom' ? 'bg-primary' : 'bg-muted',
                )}
              />
              <span className="panel-label">custom graphql url</span>
            </div>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyCustom()
                }
              }}
              placeholder="https://…/graphql"
              spellCheck={false}
              autoComplete="off"
              aria-label="custom GraphQL endpoint URL"
              className="input w-full !py-1.5 !text-xs"
            />
            <button
              type="button"
              onClick={applyCustom}
              disabled={!valid}
              className="border-line text-text hover:border-primary hover:text-primary mt-1.5 w-full border px-3 py-1.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              use endpoint
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
