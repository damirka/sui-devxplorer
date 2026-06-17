import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useNetwork } from '@/context/useNetwork'
import { NETWORKS } from '@/context/network-context'

export function NetworkSelect() {
  const { network, setNetwork } = useNetwork()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
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
        <ul
          role="listbox"
          className="panel glow animate-[fadeIn_120ms_ease] absolute right-0 z-50 mt-2 w-40 overflow-hidden p-1"
        >
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
      )}
    </div>
  )
}
