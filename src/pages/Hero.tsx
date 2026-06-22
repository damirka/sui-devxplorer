import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { SearchBar } from '@/components/ui/SearchBar'
import { useSearchHref } from '@/components/ui/links'

/** One example input per searchable kind — each runs the search when clicked. */
const HINTS: { example: string; label: string }[] = [
  { example: '0x5', label: 'object' },
  { example: '0x2::coin::Coin', label: 'type' },
  { example: '0x2::balance::send_funds', label: 'function' },
  { example: '@adeniyi', label: 'suins' },
  { example: '@deepbook/core', label: 'mvr' },
  { example: 'CiWfdYkKqsvkxp7DSWhjLjtyosvhea9vS1kPcZnNvghM', label: 'txs' },
  { example: 'checkpoints', label: 'liveness' },
]

/** Landing: the prompt is the search, centered in the viewport, with a few
 * worked examples beneath it to show what the one box accepts. */
export function Hero() {
  return (
    <div className="flex flex-1 items-center justify-center pb-16">
      <div className="w-full max-w-2xl px-2">
        <SearchBar variant="hero" autoFocus />
        <SearchHints />
      </div>
    </div>
  )
}

/** Small-print, clickable examples mapping a sample input to the kind it
 * resolves to — the cheapest way to teach the single box's grammar. */
function SearchHints() {
  const searchHref = useSearchHref()
  return (
    <div className="mt-8 grid grid-cols-[minmax(0,max-content)_auto] items-baseline gap-x-6 gap-y-2 font-mono text-xs">
      {HINTS.map((h) => (
        <Fragment key={h.example}>
          <Link
            to={searchHref(h.example)}
            title={`search ${h.example}`}
            className="text-muted hover:text-primary break-all transition-colors hover:underline"
          >
            {h.example}
          </Link>
          <span className="text-muted opacity-60 select-none">{h.label}</span>
        </Fragment>
      ))}
    </div>
  )
}
