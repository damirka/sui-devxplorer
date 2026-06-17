import { Panel, PanelSection } from '@/components/ui/Panel'
import { LinkedHash, TypeLink } from '@/components/ui/links'
import { JsonBlock } from '@/components/ui/JsonBlock'
import { CODE_PRE, DANGER_PRE } from '@/components/ui/codeBlock'
import { Muted } from '@/components/ui/Field'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchObject,
  fetchDisplayDefinition,
  fetchTypeDefinition,
  type SuiObject,
} from '@/lib/object'
import { ResultHeader } from './ResultHeader'
import { ObjectOverview } from './ObjectOverview'
import { PackageBody } from './PackageBody'
import { OwnedObjects } from './OwnedObjects'
import { DynamicFields } from './DynamicFields'
import { Txs } from './Txs'
import { Badge } from '@/components/ui/Badge'
import { SuinsNames } from './SuinsNames'
import { MvrChip } from './MvrChip'
import { UpgradeCapPanel, upgradeCapData } from './UpgradeCapPanel'
import { OwnedUpgradeCaps } from './OwnedUpgradeCaps'
import { fetchDefaultSuinsName, atName } from '@/lib/suins'
import {
  StructDeclaration,
  innerValueSignature,
  innerKeySignature,
  reprFromSignature,
} from './moveType'

export function ObjectView({
  value,
  alias,
  mvrName,
}: {
  value: string
  /** SuiNS name this id was reached by (from a name search), shown as a chip. */
  alias?: string
  /** MVR name this package was reached by (a forward name search), if any. */
  mvrName?: string
}) {
  const { network } = useNetwork()
  const { data, loading, error } = useAsync(
    (signal) => fetchObject(network, value, signal),
    [network, value],
  )

  // When not reached via a name, reverse-look-up the address's default SuiNS
  // name so any named account/object is indicated. Lazy, non-blocking.
  const reverse = useAsync(
    (signal) =>
      alias ? Promise.resolve(null) : fetchDefaultSuinsName(network, value, signal),
    [network, value, alias],
  )
  const domain = alias ?? reverse.data

  const obj = data?.object ?? null
  // A package is just an immutable object, but it reads as a "package" to a
  // dev — so once loaded, badge it as one. Unknown until the fetch resolves.
  const isPackage = !!obj?.asMovePackage
  // Object ids and account addresses share a shape. When nothing resolves at
  // the id, don't dead-end: treat it as an account address — it may still own
  // objects and have transaction history worth seeing.
  const isAddress = !loading && !error && data != null && !obj

  return (
    <div>
      <ResultHeader
        kind={isPackage ? 'package' : isAddress ? 'address' : 'object'}
        label={isPackage ? 'Package' : isAddress ? 'Address' : 'Object'}
        value={value}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {(isPackage || mvrName) && (
              <MvrChip packageId={value} knownName={mvrName} />
            )}
            {domain && <Badge kind="suins">{atName(domain)}</Badge>}
          </span>
        }
      />

      {loading && (
        <Panel>
          <PanelSection>
            <SkeletonLines count={6} />
          </PanelSection>
        </Panel>
      )}

      {error && (
        <EmptyState title="failed to load object">{error.message}</EmptyState>
      )}

      {isAddress && (
        <div className="space-y-6">
          <SuinsNames domain={domain} />
          {/* Even when nothing resolves at this id as a top-level object, it may
              still be a parent holding dynamic fields (e.g. a table/bag) — those
              are the important content, so surface them when present. */}
          <DynamicFields id={value} hideWhenEmpty />
          <OwnedUpgradeCaps id={value} hideWhenEmpty />
          <OwnedObjects id={value} />
          <Txs id={value} relation="sent" label="Transactions sent" />
        </div>
      )}

      {obj &&
        (isPackage ? (
          <PackageBody data={obj} mvrName={mvrName} />
        ) : (
          <MoveObjectBody data={obj} displayError={data?.displayError ?? null} />
        ))}
    </div>
  )
}

function MoveObjectBody({
  data,
  displayError,
}: {
  data: SuiObject
  displayError: string | null
}) {
  const { network } = useNetwork()
  const move = data.asMoveObject
  const display = move?.contents?.display
  const objectType = move?.contents?.type.repr ?? null
  const signature = move?.contents?.type.signature ?? null
  // When this object is an `0x2::package::UpgradeCap`, decode its fields so a
  // dedicated section can show (and link to) the package it governs.
  const upgradeCap = upgradeCapData(objectType, move?.contents?.json ?? null)
  // When this object is a dynamic-field wrapper (`Field<K, V>`), the Field
  // struct itself is rarely interesting — resolve the inner *value* type (V)
  // instead and show its signature + definition.
  const innerSig = innerValueSignature(signature)
  const keySig = innerKeySignature(signature)
  const defSig = innerSig ?? signature
  const innerRepr = innerSig ? reprFromSignature(innerSig) : null
  const keyRepr = keySig ? reprFromSignature(keySig) : null

  // The unrendered template lives in a separate `Display<T>` object — fetch it
  // by type once we know the object's concrete type.
  const def = useAsync(
    (signal) =>
      objectType
        ? fetchDisplayDefinition(network, objectType, signal)
        : Promise.resolve(null),
    [network, objectType],
  )

  // The source struct definition (abilities, fields, type params) lives in the
  // defining package's module — resolved from the type signature.
  const typeDef = useAsync(
    (signal) =>
      defSig
        ? fetchTypeDefinition(network, defSig, signal)
        : Promise.resolve(null),
    [network, objectType],
  )

  const showTypeDef = typeDef.loading || !!typeDef.data || !!innerRepr
  const hasDisplay =
    display?.output != null ||
    display?.errors != null ||
    displayError != null ||
    (def.data?.fields.length ?? 0) > 0

  const typeField = innerRepr ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <TypeLink type={innerRepr} copy />
      <span className="text-muted text-xs">(dynamic field)</span>
    </span>
  ) : move?.contents ? (
    <TypeLink type={move.contents.type.repr} copy />
  ) : (
    <Muted>—</Muted>
  )

  return (
    <div className="space-y-6">
      <div
        className={
          showTypeDef
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-2'
            : undefined
        }
      >
        <ObjectOverview data={data} type={typeField} />

        {showTypeDef && (
          <Panel>
            <PanelSection label="Type definition">
              {innerRepr && (
                <div className="mb-4 flex flex-col gap-3">
                  {keyRepr && (
                    <div className="flex flex-col gap-1.5">
                      <span className="panel-label">dynamic field key type</span>
                      <TypeLink type={keyRepr} copy />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <span className="panel-label">dynamic field value type</span>
                    <TypeLink type={innerRepr} copy />
                  </div>
                </div>
              )}
              {typeDef.loading ? (
                <SkeletonLines count={3} />
              ) : typeDef.data ? (
                <StructDeclaration def={typeDef.data} />
              ) : innerRepr ? (
                <Muted>primitive value — no struct definition.</Muted>
              ) : null}
            </PanelSection>
          </Panel>
        )}
      </div>

      {upgradeCap && <UpgradeCapPanel cap={upgradeCap} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelSection label="Fields">
            {move?.contents ? (
              <JsonBlock value={move.contents.json} copy />
            ) : (
              <Muted>this object has no Move struct contents.</Muted>
            )}
          </PanelSection>
        </Panel>

        <DynamicFields id={data.address} />
      </div>

      {hasDisplay && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelSection label="Display">
              {display?.output != null ? (
                <pre className={CODE_PRE}>
                  <code>{JSON.stringify(display.output, null, 2)}</code>
                </pre>
              ) : (
                <Muted>no rendered display for this object.</Muted>
              )}

              {(display?.errors != null || displayError != null) && (
                <div className="mt-5">
                  <span className="text-danger font-mono text-[0.6875rem] tracking-wide lowercase">
                    display errors
                  </span>
                  <pre className={DANGER_PRE}>
                    <code>
                      {JSON.stringify(display?.errors ?? displayError, null, 2)}
                    </code>
                  </pre>
                </div>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection
              label="Display definition"
              action={
                def.data ? <LinkedHash value={def.data.address} /> : undefined
              }
            >
              {def.data && def.data.fields.length > 0 ? (
                <ul className="divide-line border-line divide-y border font-mono text-xs">
                  {def.data.fields.map((f) => (
                    <li
                      key={f.key}
                      className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3"
                    >
                      <span className="text-primary sm:w-36 sm:shrink-0">
                        {f.key}
                      </span>
                      <span className="text-muted break-all">{f.value}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>no display definition registered for this type.</Muted>
              )}
            </PanelSection>
          </Panel>
        </div>
      )}

      <OwnedObjects id={data.address} />
      <Txs id={data.address} relation="object" label="Transactions" />
    </div>
  )
}
