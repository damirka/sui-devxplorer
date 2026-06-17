import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Run an async fetcher and track loading/error/data. Re-runs whenever `deps`
 * change; aborts the in-flight request on change/unmount so stale responses
 * never land. The fetcher receives an AbortSignal to forward to `fetch`.
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
    setState({ data: null, loading: true, error: null })

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
