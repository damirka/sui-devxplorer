import { useSearchParams } from 'react-router-dom'
import { Hero } from './Hero'
import { ResultRouter } from './results/ResultRouter'

/** Single search-driven route: hero when empty, result view when `?search` set. */
export function Home() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get('search')?.trim() ?? ''

  if (!search) return <Hero />
  return <ResultRouter search={search} />
}
