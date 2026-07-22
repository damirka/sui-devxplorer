import { Panel, PanelSection } from '@/components/ui/Panel'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { LinkedHash, TypeLink } from '@/components/ui/links'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { formatTimestamp } from '@/lib/format'
import { describeOwner, type ObjectOwner } from '@/lib/object'
import {
  fetchWrappedInfo,
  describePath,
  type WrappedInfo,
} from '@/lib/wrapped'
import { DynamicFields } from './DynamicFields'
import { Balances } from './Balances'
import { OwnedObjects } from './OwnedObjects'
import { Txs } from './Txs'

/**
 * The result view for a *wrapped UID* — an id that was created already embedded
 * inside another object's struct, so it never existed as a standalone object
 * (`object()` null, no version history). Everything shown here is recovered
 * forensically from the id's creating transaction (see `lib/wrapped.ts`) and
 * laid out to read like the standard object view: an overview (type, wrapper,
 * owner, location, creating tx), then the same live panels a real object gets —
 * dynamic fields (a wrapped `Table`'s entries live here), balances, owned
 * objects, and the txs that touched the id.
 */
export function WrappedBody({
  id,
  createdTx,
}: {
  id: string
  /** The id's creating transaction (its earliest `affectedObject` hit). */
  createdTx: { digest: string; timestamp: string | null }
}) {
  const { network } = useNetwork()
  const info = useAsync(
    (signal) => fetchWrappedInfo(network, id, createdTx.digest, signal),
    [network, id, createdTx.digest],
  )

  const data = info.loading ? null : info.data
  const wrapper = data?.wrapper ?? null
  // Owner / path from the wrapper's *current* state when the id is still held
  // there; the at-creation snapshot otherwise.
  const present = data?.current.state === 'present' ? data.current : null
  const owner: ObjectOwner | null = present?.owner ?? wrapper?.owner ?? null
  const path = present?.path ?? wrapper?.path ?? null

  return (
    <div className="space-y-6">
      <WrappedBanner loading={info.loading} error={info.error} data={data} />

      <Panel>
        <PanelSection>
          {info.loading ? (
            <SkeletonLines count={4} />
          ) : (
            <FieldGrid>
              <Field label="Type">
                {data?.containerType ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <TypeLink type={data.containerType} copy />
                    <span className="text-muted text-xs">(wrapped)</span>
                  </span>
                ) : (
                  <Muted>
                    {data?.kind === 'reference'
                      ? 'unknown — only a reference to this id was found'
                      : 'unknown'}
                  </Muted>
                )}
              </Field>
              <Field label="Wrapper">
                {wrapper ? <LinkedHash value={wrapper.address} /> : <Muted>—</Muted>}
              </Field>
              <Field label="Wrapper type">
                {wrapper?.type ? <TypeLink type={wrapper.type} copy /> : <Muted>—</Muted>}
              </Field>
              <Field label="Wrapper owner">
                <OwnerValue owner={owner} />
              </Field>
              <Field label="Location">
                {path ? (
                  <span
                    className="font-mono text-sm break-all"
                    title="field path to this id inside the wrapper's contents"
                  >
                    {describePath(path) || '(top level)'}
                  </span>
                ) : (
                  <Muted>—</Muted>
                )}
              </Field>
              <Field label="Created tx">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <LinkedHash value={createdTx.digest} />
                  {createdTx.timestamp && (
                    <span className="text-muted text-xs">
                      {formatTimestamp(createdTx.timestamp)}
                    </span>
                  )}
                </span>
              </Field>
            </FieldGrid>
          )}
        </PanelSection>
      </Panel>

      {/* The same live panels a standard object gets. A wrapped UID is most
          often a container (`Table` / `Bag`) — its entries are the dynamic
          fields of this id, so that panel is the primary content. */}
      <DynamicFields id={id} />
      <Balances id={id} hideWhenEmpty />
      <OwnedObjects id={id} hideWhenEmpty />
      <Txs id={id} relation="object" />
    </div>
  )
}

/** The explainer banner: what a wrapped UID is, plus the wrapper-resolution
 *  verdict (held / no longer found / unverifiable). */
function WrappedBanner({
  loading,
  error,
  data,
}: {
  loading: boolean
  error: Error | null
  data: WrappedInfo | null
}) {
  return (
    <div className="border-line bg-surface-2 space-y-1.5 border px-4 py-3 font-mono text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-primary font-semibold tracking-wider uppercase">
          wrapped
        </span>
        <span className="text-muted">
          this id is a UID embedded inside another object — it was created
          already wrapped and has never been a standalone object.
        </span>
      </div>
      <div className="text-muted">
        {loading ? (
          <span className="opacity-60">locating the wrapper object…</span>
        ) : error ? (
          <span className="text-danger">wrapper lookup failed: {error.message}</span>
        ) : (
          data && <WrapperVerdict data={data} />
        )}
      </div>
    </div>
  )
}

/** One line stating where the id stands now, per the two-step resolution. */
function WrapperVerdict({ data }: { data: WrappedInfo }) {
  const { wrapper, current } = data
  if (!wrapper) {
    return (
      <span>
        the wrapper couldn't be located — no changed object in the creating
        transaction embeds this id in its contents.
      </span>
    )
  }
  switch (current.state) {
    case 'present':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span>currently held inside</span>
          <LinkedHash value={wrapper.address} />
          {current.version != null && (
            <span className="text-muted/70">(v{current.version})</span>
          )}
          {wrapper.truncated && (
            <span className="text-muted/70">· scan was partial</span>
          )}
        </span>
      )
    case 'absent':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span>was created inside</span>
          <LinkedHash value={wrapper.address} />
          <span>
            but its current contents
            {current.version != null ? ` (v${current.version})` : ''} no longer
            embed this id — it may have been moved, extracted, or deleted. its
            current location can't be determined.
          </span>
        </span>
      )
    case 'wrapper-gone':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span>was created inside</span>
          <LinkedHash value={wrapper.address} />
          <span>
            — but that wrapper is itself no longer in the live object set, so
            this id's current location can't be verified.
          </span>
        </span>
      )
    case 'unknown':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span>was created inside</span>
          <LinkedHash value={wrapper.address} />
          <span>— its current state couldn't be checked.</span>
        </span>
      )
  }
}

/** Owner rendered the same way the standard object overview does. */
function OwnerValue({ owner }: { owner: ObjectOwner | null }) {
  const d = describeOwner(owner)
  if (!owner) return <Muted>—</Muted>
  return d.address ? (
    <span className="flex items-center gap-2">
      <span className="text-muted text-xs">{d.kind}</span>
      <LinkedHash value={d.address} />
    </span>
  ) : (
    <span className="font-mono text-sm">{d.kind}</span>
  )
}

/**
 * The compact wrapper panel for an object that existed and was *later* wrapped
 * (the deleted-object view's `removal` tx removed it without `idDeleted`).
 * Runs the same two-step resolution against the wrapping transaction and
 * reports where the object sits now.
 */
export function WrapperPanel({ id, txDigest }: { id: string; txDigest: string }) {
  const { network } = useNetwork()
  const info = useAsync(
    (signal) => fetchWrappedInfo(network, id, txDigest, signal),
    [network, id, txDigest],
  )
  const data = info.loading ? null : info.data
  const wrapper = data?.wrapper ?? null
  const present = data?.current.state === 'present' ? data.current : null
  const path = present?.path ?? wrapper?.path ?? null

  return (
    <Panel>
      <PanelSection label="Wrapper">
        {info.loading ? (
          <SkeletonLines count={2} />
        ) : info.error ? (
          <Muted>wrapper lookup failed: {info.error.message}</Muted>
        ) : !wrapper ? (
          <Muted>
            couldn't locate the wrapper — no changed object in the wrapping
            transaction embeds this id in its contents.
          </Muted>
        ) : (
          <div className="space-y-4">
            <div className="font-mono text-xs">
              {data && <WrapperVerdict data={data} />}
            </div>
            <FieldGrid>
              <Field label="Wrapper">
                <LinkedHash value={wrapper.address} />
              </Field>
              <Field label="Wrapper type">
                {wrapper.type ? <TypeLink type={wrapper.type} copy /> : <Muted>—</Muted>}
              </Field>
              <Field label="Wrapper owner">
                <OwnerValue owner={present?.owner ?? wrapper.owner} />
              </Field>
              <Field label="Location">
                {path ? (
                  <span
                    className="font-mono text-sm break-all"
                    title="field path to this id inside the wrapper's contents"
                  >
                    {describePath(path) || '(top level)'}
                  </span>
                ) : (
                  <Muted>—</Muted>
                )}
              </Field>
            </FieldGrid>
          </div>
        )}
      </PanelSection>
    </Panel>
  )
}
