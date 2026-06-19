import { Link } from 'react-router-dom'
import { useSearchHref } from '@/components/ui/links'
import { truncateMiddle } from '@/lib/search'
import { ObjectChangeDiff } from './ObjectChangeDiff'

/**
 * The "Fields" panel in diff mode: how the transaction that produced *this*
 * version of the object changed its contents (its `previousTransaction`). A thin
 * wrapper over `ObjectChangeDiff` that labels it as the last transaction's diff
 * and links it.
 */
export function FieldsDiff({
  id,
  txDigest,
  type,
}: {
  id: string
  /** The transaction that produced the version being viewed. */
  txDigest: string
  /** The object's Move type repr, shown as the diff's root label. */
  type: string | null
}) {
  const searchHref = useSearchHref()
  return (
    <ObjectChangeDiff
      id={id}
      txDigest={txDigest}
      type={type}
      note={
        <span>
          diff from the last transaction{' '}
          <Link
            to={searchHref(txDigest)}
            title={txDigest}
            className="text-primary hover:underline"
          >
            {truncateMiddle(txDigest)}
          </Link>
        </span>
      }
    />
  )
}
