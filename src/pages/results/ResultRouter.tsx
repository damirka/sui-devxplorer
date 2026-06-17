import { detectSearchKind } from '@/lib/search'
import { ObjectView } from './ObjectView'
import { TransactionView } from './TransactionView'
import { PackageView } from './PackageView'
import { SuinsView } from './SuinsView'
import { NotFound } from './NotFound'

/** Classify the raw search string and render the matching result view. */
export function ResultRouter({ search }: { search: string }) {
  const { kind, value } = detectSearchKind(search)

  switch (kind) {
    case 'object':
      return <ObjectView value={value} />
    case 'transaction':
      return <TransactionView value={value} />
    case 'package':
      return <PackageView value={value} />
    case 'suins':
      return <SuinsView value={value} />
    case 'unknown':
      return <NotFound value={search} />
  }
}
