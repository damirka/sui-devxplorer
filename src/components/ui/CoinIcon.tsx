import { useState } from 'react'
import { Coins } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * A coin's icon from its `CoinMetadata.iconUrl`. Falls back to the symbol's
 * initial — or a generic coin glyph — when there's no url or the image fails to
 * load. The url comes from on-chain metadata (untrusted), so the image is
 * lazy-loaded, size-capped, and never executes (a plain `<img>`).
 */
export function CoinIcon({
  url,
  symbol,
  className,
}: {
  url?: string
  symbol?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const base = cn('h-5 w-5 shrink-0 rounded-full', className)

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(base, 'border-line bg-surface border object-cover')}
      />
    )
  }

  const initial = symbol?.trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden
      className={cn(
        base,
        'border-line text-muted bg-surface flex items-center justify-center border text-[0.625rem] font-semibold',
      )}
    >
      {initial || <Coins size={11} />}
    </span>
  )
}
