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
}: {
  data: SuiObject
  type?: ReactNode
  isPackage?: boolean
}) {
  const owner = describeOwner(data.owner)

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
          <Field label="Previous tx">
            {data.previousTransaction ? (
              <LinkedHash value={data.previousTransaction.digest} />
            ) : (
              <Muted>—</Muted>
            )}
          </Field>
          <Field label="Digest">
            {data.digest ? <Hash value={data.digest} copy /> : <Muted>—</Muted>}
          </Field>
        </FieldGrid>
      </PanelSection>
    </Panel>
  )
}
