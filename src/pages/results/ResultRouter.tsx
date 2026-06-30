import { detectSearchKind } from '@/lib/search'
import { ObjectView } from './ObjectView'
import { TransactionView } from './TransactionView'
import { PackageView } from './PackageView'
import { SuinsView } from './SuinsView'
import { MvrView } from './MvrView'
import { CheckpointsView } from './CheckpointsView'
import { ValidatorsView } from './ValidatorsView'
import { NotFound } from './NotFound'

/** Classify the raw search string and render the matching result view. */
export function ResultRouter({
  search,
  version = null,
}: {
  search: string
  /** Object-version pin from `?version=` — only meaningful for object results. */
  version?: number | null
}) {
  const { kind, value } = detectSearchKind(search)

  switch (kind) {
    case 'object':
      return <ObjectView value={value} version={version} />
    case 'transaction':
      return <TransactionView value={value} />
    case 'package':
      return <PackageView value={value} />
    case 'suins':
      return <SuinsView value={value} />
    case 'mvr':
      return <MvrView value={value} />
    case 'checkpoints':
      return <CheckpointsView />
    case 'validators':
      return <ValidatorsView />
    case 'unknown':
      return <NotFound value={search} />
  }
}
