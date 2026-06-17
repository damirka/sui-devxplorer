import { fmtIndex } from './Panel'

/**
 * The leading `01`/`02` menu index on a list row (Sifu-style). `.menu-num`
 * already sets `tabular-nums`, so callers don't repeat it.
 */
export function RowIndex({ n }: { n: number }) {
  return <span className="menu-num shrink-0">{fmtIndex(n)}</span>
}
