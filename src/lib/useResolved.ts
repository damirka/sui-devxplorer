import { useEffect, useState, type DependencyList } from 'react'

/**
 * Resolve a value asynchronously, clearing to `null` the moment the inputs
 * change — the opposite of `useAsync`'s stale-while-revalidate, for lookups
 * where showing the *previous* input's answer would mislead (a name next to a
 * different address). Return `null` from `resolve` to skip the lookup.
 */
export function useResolved<T>(
  resolve: () => Promise<T | null> | null,
  deps: DependencyList,
): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    setValue(null)
    const pending = resolve()
    if (!pending) return
    let active = true
    pending.then((v) => {
      if (active) setValue(v)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
