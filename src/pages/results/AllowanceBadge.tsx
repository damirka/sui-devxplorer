import { Badge } from '@/components/ui/Badge'
import { formatAgo, formatSpan } from '@/lib/format'
import { allowanceStatus, type AllowanceData } from '@/lib/allowance'

/**
 * An allowance's status tag: green while spendable, muted before it starts,
 * alarm-red once expired, spent out, or revoked (the object is gone — pass
 * `revoked`, or no allowance at all). The tooltip names the bound behind it as
 * a relative time (the owner travels — never a wall-clock date).
 */
export function AllowanceStatusBadge({
  allowance,
  revoked = false,
  now = Date.now(),
  className,
}: {
  allowance: AllowanceData | null
  revoked?: boolean
  now?: number
  className?: string
}) {
  if (revoked || !allowance) {
    return (
      <Badge
        tone="danger"
        className={className}
        title="revoked — the funder destroyed the allowance and its cap"
      >
        revoked
      </Badge>
    )
  }
  const status = allowanceStatus(allowance, now)
  const title =
    status === 'expired' && allowance.expirationMs != null
      ? `expired ${formatAgo(now - allowance.expirationMs)}`
      : status === 'not started' && allowance.startMs != null
        ? `starts in ${formatSpan(allowance.startMs - now)}`
        : status === 'exhausted'
          ? 'lifetime cap reached'
          : allowance.expirationMs != null
            ? `expires in ${formatSpan(allowance.expirationMs - now)}`
            : 'no expiration — bounded by its rate limit'
  return (
    <Badge
      tone={status === 'active' ? undefined : status === 'not started' ? 'muted' : 'danger'}
      className={className}
      title={title}
    >
      {status}
    </Badge>
  )
}
