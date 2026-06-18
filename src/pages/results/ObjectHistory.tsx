import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useVersionHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchObjectVersions } from '@/lib/object'
import { formatTimestamp } from '@/lib/format'
import { truncateMiddle } from '@/lib/search'
import { cn } from '@/lib/cn'

/**
 * An object's version history, newest-first. Each row pins the object to that
 * version (`?version=`), so you can time-travel its state; the row for the
 * version currently being viewed is highlighted. Pairs with the left/right
 * arrow-key stepper wired up in `ObjectView`.
 *
 * History is queried newest-first (`last`/`before`), so the shared cursor pager
 * walks *backwards in time*: its `after` slot actually holds the `before` cursor
 * of the next, older page.
 */
export function ObjectHistory({
  id,
  currentVersion,
}: {
  id: string
  /** The version currently shown — its row is highlighted. */
  currentVersion: number | null
}) {
  const { network } = useNetwork()
  const versionHref = useVersionHref()
  // Collapsed by default — it's a power feature, kept out of the way until asked
  // for. We don't fetch the history until it's opened.
  const [open, setOpen] = useState(false)
  const pager = useCursorPager(`${network}|${id}`)
  const { data, loading, error } = useAsync(
    (signal) =>
      open
        ? fetchObjectVersions(network, id, { last: pager.pageSize, before: pager.after }, signal)
        : Promise.resolve(null),
    [network, id, pager.pageSize, pager.after, open],
  )

  const paged = pager.pageIndex > 0 || !!data?.hasOlder

  return (
    <Panel>
      <PanelSection
        label={
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="panel-label hover:text-primary -my-1 flex items-center gap-2 py-1 transition-colors"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Version history
          </button>
        }
        action={
          open ? (
            <span className="flex items-center gap-3">
              <span className="text-muted/60 hidden font-mono text-[0.625rem] tracking-wide sm:inline">
                ←/→ to step
              </span>
              {paged && (
                <Pager
                  pageIndex={pager.pageIndex}
                  pageSize={pager.pageSize}
                  onPageSize={pager.setPageSize}
                  hasNext={!!data?.hasOlder}
                  onPrev={pager.prev}
                  onNext={() => pager.next(data?.olderCursor ?? null)}
                  label="versions"
                />
              )}
            </span>
          ) : (
            <span className="text-muted/60 font-mono text-[0.625rem] tracking-wide">
              show
            </span>
          )
        }
      >
        {!open ? null : loading ? (
          <SkeletonLines count={5} />
        ) : error ? (
          <span className="text-danger font-mono text-xs">{error.message}</span>
        ) : data && data.versions.length > 0 ? (
          <ul className="divide-line divide-y font-mono text-xs">
            {data.versions.map((v) => {
              const active = v.version === currentVersion
              return (
                <li key={v.version}>
                  <Link
                    to={versionHref(v.version)}
                    title={`view this object at v${v.version}`}
                    className={cn(
                      '-mx-2 flex items-center gap-x-3 px-2 py-2.5 transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular-nums',
                        active ? 'text-primary' : 'text-text',
                      )}
                    >
                      v{v.version}
                    </span>
                    <span className="text-muted shrink-0">
                      {formatTimestamp(v.timestamp)}
                    </span>
                    {v.txDigest && (
                      <span className="hash text-muted ml-auto shrink-0">
                        {truncateMiddle(v.txDigest)}
                      </span>
                    )}
                    {active && (
                      <span className="border-primary/40 text-primary shrink-0 border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase">
                        viewing
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <span className="text-muted text-sm">no version history.</span>
        )}
      </PanelSection>
    </Panel>
  )
}
