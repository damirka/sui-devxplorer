import { useSearchParams } from 'react-router-dom'
import { Hero } from './Hero'
import { ResultRouter } from './results/ResultRouter'

/** Single search-driven route: hero when empty, result view when `?search` set. */
export function Home() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get('search')?.trim() ?? ''
  // Optional object-version pin (`?version=`); ignored for non-object results.
  const v = Number(searchParams.get('version'))
  const version = Number.isInteger(v) && v > 0 ? v : null

  if (!search) return <Hero />
  return <ResultRouter search={search} version={version} />
}
