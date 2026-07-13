import { useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Run an async fetcher and track loading/error/data. Re-runs whenever `deps`
 * change; aborts the in-flight request on change/unmount so stale responses
 * never land. The fetcher receives an AbortSignal to forward to `fetch`.
 *
 * Stale-while-revalidate: on a deps change the previous `data` is KEPT while
 * `loading` flips true, so views can hold their layout (e.g. `DataList` dims the
 * old rows instead of collapsing to a skeleton). Gate on `loading` wherever
 * acting on another identity's data would be wrong — the data may be stale
 * whenever `loading` is true.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ data: s.data, loading: true, error: null }))

    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/**
 * Like {@link useAsync}, but additionally re-fetches every `pollMs` while that's
 * a positive number (`null` = no polling) — for live views that watch for new
 * data. A poll refresh swaps in the new result without touching `loading`; a
 * `deps` change flips `loading` while KEEPING the current data (stale-while-
 * revalidate, same as `useAsync`) so lists hold their height across reloads.
 * Polls pause while the tab is hidden, and transient poll errors are swallowed
 * so the last good data stays.
 */
export function usePolledAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  pollMs: number | null,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  })
  // Always poll with the freshest fetcher (it closes over the latest deps)
  // without re-arming the interval on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Primary load: flips loading (keeping stale data) when the query identity
  // changes.
  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ data: s.data, loading: true, error: null }))

    fetcherRef.current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Background polling: refresh on an interval without touching `loading`.
  useEffect(() => {
    if (!pollMs || pollMs <= 0) return
    let controller: AbortController | null = null
    const tid = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      controller?.abort()
      controller = new AbortController()
      const c = controller
      fetcherRef.current(c.signal)
        .then((data) => {
          if (!c.signal.aborted) {
            setState((s) => ({ ...s, data, loading: false, error: null }))
          }
        })
        .catch(() => {
          /* keep the last good data on a transient poll failure */
        })
    }, pollMs)

    return () => {
      controller?.abort()
      clearInterval(tid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, ...deps])

  return state
}
