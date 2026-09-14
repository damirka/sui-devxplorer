import { useEffect } from 'react'
import { useNetwork } from '@/context/useNetwork'
import { detectSearchKind, KIND_META } from './search'
import { formatIdentifier } from './format'

/** Landing-page title — must match the static `<title>` in `index.html`, which
 *  is what crawlers and link previews see before JavaScript runs. */
export const SITE_TITLE = 'DevXplorer — Sui explorer for developers'

/**
 * Tab / history / bookmark title for the current route. The landing page keeps
 * the site title; a result page reads `<kind> <id> · <network> · DevXplorer`
 * (`tx 5Gh…xYz · mainnet · DevXplorer`), so a row of open tabs or a browser
 * history search tells the pages apart.
 */
export function useDocumentTitle(search: string) {
  const { network } = useNetwork()
  useEffect(() => {
    if (!search) {
      document.title = SITE_TITLE
      return
    }
    const { kind, value } = detectSearchKind(search)
    const tag = kind === 'unknown' ? 'not found' : KIND_META[kind].tag
    const id = kind === 'checkpoints' || kind === 'validators' ? '' : ` ${formatIdentifier(value)}`
    document.title = `${tag}${id} · ${network} · DevXplorer`
  }, [search, network])
}
