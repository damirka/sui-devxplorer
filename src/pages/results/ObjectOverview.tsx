import type { ReactNode } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Hash } from '@/components/ui/Hash'
import { LinkedHash } from '@/components/ui/links'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { describeOwner, type SuiObject } from '@/lib/object'

/**
 * The shared object/package overview: type, owner, version, storage rebate,
 * previous tx, and digest. The `type` slot is supplied by the caller — a
 * `TypeLink` for Move objects. Packages set `isPackage` to drop the fields that
 * don't apply to an immutable package (type, owner, storage rebate).
 */
export function ObjectOverview({
  data,
  type,
  isPackage = false,
  createdTx,
  deletedTx,
}: {
  data: SuiObject
  type?: ReactNode
  isPackage?: boolean
  /** The tx that created the object (its first version). Renders a "Created tx"
   *  field; `null` shows `—`. Omit to hide the field entirely. */
  createdTx?: string | null
  /** The tx that removed the object. Renders a "Deleted tx" field — pass only for
   *  a deleted object; `null` (removal tx pruned) shows `—`. Omit to hide it. */
  deletedTx?: string | null
}) {
  const owner = describeOwner(data.owner)
  const prevTx = data.previousTransaction?.digest ?? null
  // The producing tx of the current version. For a never-mutated object it *is*
  // the creating tx — when a `createdTx` is given and equal, show it once (as
  // "created") rather than duplicating the row.
  const showPrev = prevTx != null && prevTx !== createdTx

  // A package has only three relevant fields — lay them out as compact
  // one-line `LABEL value` rows that wrap, instead of the tall label-above grid.
  if (isPackage) {
    return (
      <Panel>
        <PanelSection>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-3">
            <Field inline label="Version">
              <span className="font-mono text-sm">{data.version ?? '—'}</span>
            </Field>
            <Field inline label="Previous tx">
              {data.previousTransaction ? (
                <LinkedHash value={data.previousTransaction.digest} />
              ) : (
                <Muted>—</Muted>
              )}
            </Field>
            <Field inline label="Digest">
              {data.digest ? (
                <Hash value={data.digest} copy />
              ) : (
                <Muted>—</Muted>
              )}
            </Field>
          </div>
        </PanelSection>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelSection>
        <FieldGrid>
          <Field label="Type">{type}</Field>
          <Field label="Owner">
            {owner.address ? (
              <span className="flex items-center gap-2">
                <span className="text-muted text-xs">{owner.kind}</span>
                <LinkedHash value={owner.address} />
              </span>
            ) : (
              <span className="font-mono text-sm">{owner.kind}</span>
            )}
          </Field>
          <Field label="Version">
            <span className="font-mono text-sm">{data.version ?? '—'}</span>
          </Field>
          <Field label="Storage rebate">
            <span className="font-mono text-sm">
              {data.storageRebate ?? '—'}
              {data.storageRebate ? ' MIST' : ''}
            </span>
          </Field>
          {createdTx !== undefined && (
            <Field label="Created tx">
              {createdTx ? <LinkedHash value={createdTx} /> : <Muted>—</Muted>}
            </Field>
          )}
          {showPrev && (
            <Field label="Previous tx">
              <LinkedHash value={prevTx} />
            </Field>
          )}
          {deletedTx !== undefined && (
            <Field label="Deleted tx">
              {deletedTx ? <LinkedHash value={deletedTx} /> : <Muted>—</Muted>}
            </Field>
          )}
          <Field label="Digest">
            {data.digest ? <Hash value={data.digest} copy /> : <Muted>—</Muted>}
          </Field>
        </FieldGrid>
      </PanelSection>
    </Panel>
  )
}
