import type { ReactNode } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Hash } from '@/components/ui/Hash'
import { LinkedHash } from '@/components/ui/links'
import { Field, FieldGrid, Muted } from '@/components/ui/Field'
import { describeOwner, type SuiObject } from '@/lib/object'

/**
 * The shared object/package overview: owner, version, storage rebate, previous
 * tx, and digest. The `type` slot is supplied by the caller — a `TypeLink` for
 * Move objects, a plain "package" label for packages — since that's the one
 * field whose rendering differs between the two.
 */
export function ObjectOverview({
  data,
  type,
}: {
  data: SuiObject
  type: ReactNode
}) {
  const owner = describeOwner(data.owner)
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
