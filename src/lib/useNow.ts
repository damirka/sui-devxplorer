import { useEffect, useState } from 'react'

/**
 * A clock that re-renders every `intervalMs` with the current epoch-ms. For live
 * "age" / "lag" readouts that must keep ticking between data refreshes — and,
 * crucially, keep advancing even when a poll fails: a frozen feed then still
 * surfaces as increasingly stale (the tip ages) rather than looking healthy.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
