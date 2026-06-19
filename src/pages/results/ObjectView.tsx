import { useEffect, useState } from 'react'
import { Diff, Eye } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { LinkedHash, TypeLink, useVersionHref } from '@/components/ui/links'
import { JsonTree } from '@/components/ui/JsonTree'
import { CODE_PRE, DANGER_PRE } from '@/components/ui/codeBlock'
import { cn } from '@/lib/cn'
import { Muted } from '@/components/ui/Field'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchObject,
  fetchDisplayDefinition,
  fetchTypeDefinition,
  describeOwner,
  type SuiObject,
} from '@/lib/object'
import { ResultHeader } from './ResultHeader'
import { ObjectOverview } from './ObjectOverview'
import { ObjectHistory } from './ObjectHistory'
import { PackageBody } from './PackageBody'
import { OwnedObjects } from './OwnedObjects'
import { DynamicFields } from './DynamicFields'
import { FieldsDiff } from './FieldsDiff'
import { Txs } from './Txs'
import { ObjectTransactions } from './ObjectTransactions'
import { Badge } from '@/components/ui/Badge'
import { SuinsNames } from './SuinsNames'
import { SignerPanel } from './SignerPanel'
import { fetchSignerScheme } from '@/lib/transaction'
import { MvrChip } from './MvrChip'
import { UpgradeCapPanel, upgradeCapData } from './UpgradeCapPanel'
import { OwnedUpgradeCaps } from './OwnedUpgradeCaps'
import { Balances } from './Balances'
import { DisplayModal } from './DisplayModal'
import { fetchDefaultSuinsName, atName } from '@/lib/suins'
import {
  StructDeclaration,
  innerValueSignature,
  innerKeySignature,
  reprFromSignature,
} from './moveType'

export function ObjectView({
  value,
  version = null,
  alias,
  mvrName,
}: {
  value: string
  /** Pin the object to this version (`?version=`); latest when null. */
  version?: number | null
  /** SuiNS name this id was reached by (from a name search), shown as a chip. */
  alias?: string
  /** MVR name this package was reached by (a forward name search), if any. */
  mvrName?: string
}) {
  const { network } = useNetwork()
  const navigate = useNavigate()
  const versionHref = useVersionHref()
  const { data, loading, error } = useAsync(
    (signal) => fetchObject(network, value, version, signal),
    [network, value, version],
  )

  // The rendered-Display modal. State lives here (not in `MoveObjectBody`, which
  // unmounts while a version reloads) so the modal stays open as you step
  // through versions. Reset only when the object/network changes — not on a
  // version step, which is the whole point.
  const [displayOpen, setDisplayOpen] = useState(false)
  useEffect(() => setDisplayOpen(false), [value, network])

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
  // A pinned version that resolves to nothing is a bad version, not an address.
  const missingVersion = version != null && !loading && !error && data != null && !obj
  // Object ids and account addresses share a shape. When nothing resolves at
  // the id, don't dead-end: treat it as an account address — it may still own
  // objects and have transaction history worth seeing. (Not when a version is
  // pinned — that's a specific object lookup, handled above.)
  const isAddress =
    version == null && !loading && !error && data != null && !obj

  // An address carries no on-chain marker for how it signs — the only signal is
  // a transaction it authored. Probe for it once we know this id is an address,
  // so we can badge the scheme (Ed25519 / multisig / zkLogin / passkey / …) and
  // show its detail. Skipped for objects/packages (resolves null, no request).
  const signer = useAsync(
    (signal) =>
      isAddress ? fetchSignerScheme(network, value, signal) : Promise.resolve(null),
    [network, value, isAddress],
  )

  // Display data for the modal, read from the live `obj` (null while a version
  // reloads — the modal retains the last render across that gap).
  const display = obj?.asMoveObject?.contents?.display?.output
  const displayOutput =
    display && typeof display === 'object' && !Array.isArray(display)
      ? (display as Record<string, unknown>)
      : null

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
            {signer.data && <Badge>{signer.data.scheme}</Badge>}
            {obj && !isPackage && version != null && (
              <Badge>v{obj.version}</Badge>
            )}
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

      {missingVersion && (
        <EmptyState title={`no version ${version} of this object`}>
          this object has no such version on {network}.{' '}
          <Link to={versionHref(null)} className="text-primary hover:underline">
            view latest
          </Link>
        </EmptyState>
      )}

      {isAddress && (
        <div className="space-y-6">
          <SuinsNames domain={domain} />
          <SignerPanel info={signer.data} />
          <Balances id={value} />
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
          <MoveObjectBody
            data={obj}
            displayError={data?.displayError ?? null}
            onViewDisplay={() => setDisplayOpen(true)}
          />
        ))}

      {/* Rendered-display modal — mounted at the view root (keyed per object)
          so it survives the version reloads `MoveObjectBody` does not. */}
      <DisplayModal
        key={`${network}|${value}`}
        open={displayOpen}
        onClose={() => setDisplayOpen(false)}
        output={displayOutput}
        loading={loading}
        version={obj?.version ?? null}
        olderVersion={obj?.olderVersion?.nodes[0]?.version ?? null}
        newerVersion={obj?.newerVersion?.nodes[0]?.version ?? null}
        onStep={(v) => navigate(versionHref(v))}
      />
    </div>
  )
}

function MoveObjectBody({
  data,
  displayError,
  onViewDisplay,
}: {
  data: SuiObject
  displayError: string | null
  /** Open the rendered-display modal (owned by `ObjectView`). */
  onViewDisplay: () => void
}) {
  const { network } = useNetwork()
  const navigate = useNavigate()
  const versionHref = useVersionHref()

  // Immediate version neighbours, for the left/right stepper. A newer neighbour
  // existing means we're viewing a historical snapshot, not the live object.
  const olderVersion = data.olderVersion?.nodes[0]?.version ?? null
  const newerVersion = data.newerVersion?.nodes[0]?.version ?? null
  const historical = newerVersion != null
  const hasHistory = olderVersion != null || newerVersion != null

  // Hidden power-user nav: ←/→ step to the older/newer version (unless typing
  // in a field). Exact neighbours, so it hops across Lamport-version gaps.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const a = document.activeElement as HTMLElement | null
      const tag = a?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a?.isContentEditable) {
        return
      }
      const target = e.key === 'ArrowLeft' ? olderVersion : newerVersion
      if (target == null) return
      e.preventDefault()
      navigate(versionHref(target))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [olderVersion, newerVersion, navigate, versionHref])

  // Toggle the Fields panel between the contents JSON and a unified diff of what
  // the producing transaction changed.
  const [showDiff, setShowDiff] = useState(false)

  const move = data.asMoveObject
  const display = move?.contents?.display
  const objectType = move?.contents?.type.repr ?? null
  // The transaction that produced the version being viewed — drives the diff.
  const prevTx = data.previousTransaction?.digest ?? null
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

  // `live` = viewing the current version. The state-derived panels below
  // (dynamic fields, owned objects, balances, transactions, rendered display)
  // always reflect the *latest* object, so we hide them on a historical
  // snapshot rather than show stale-looking current data next to old contents.
  const live = !historical

  return (
    <div className="space-y-6">
      {historical && (
        <div className="border-line bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-3 font-mono text-xs">
          <span className="text-primary shrink-0">viewing v{data.version}</span>
          <span className="text-muted">
            — a historical snapshot. live-only panels (dynamic fields, owned
            objects, balances, transactions) are hidden.
          </span>
          <Link
            to={versionHref(null)}
            className="text-primary ml-auto shrink-0 hover:underline"
          >
            view latest →
          </Link>
        </div>
      )}

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

      {hasHistory && (
        <ObjectHistory
          id={data.address}
          currentVersion={data.version}
          showOwners={!!describeOwner(data.owner).address}
        />
      )}

      <div className={live ? 'grid grid-cols-1 gap-6 lg:grid-cols-2' : undefined}>
        <Panel>
          <PanelSection
            label="Fields"
            action={
              move?.contents && prevTx ? (
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  aria-pressed={showDiff}
                  title="what the producing transaction changed in this object"
                  className={cn(
                    'inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-xs transition-colors',
                    showDiff
                      ? 'border-primary text-primary'
                      : 'border-line text-muted hover:text-primary',
                  )}
                >
                  <Diff size={12} />
                  {showDiff ? 'show fields' : 'show diff'}
                </button>
              ) : undefined
            }
          >
            {move?.contents ? (
              showDiff && prevTx ? (
                <FieldsDiff id={data.address} txDigest={prevTx} type={objectType} />
              ) : (
                <JsonTree value={move.contents.json} copy />
              )
            ) : (
              <Muted>this object has no Move struct contents.</Muted>
            )}
          </PanelSection>
        </Panel>

        {/* Dynamic fields resolve to the live object only — hide on a snapshot. */}
        {live && <DynamicFields id={data.address} />}
      </div>

      {/* Display renders from THIS node's contents (the resolver applies the
          current Display<T> template to the version's fields), so it's honest to
          show on a historical snapshot too — unlike the live-only panels below. */}
      {hasDisplay && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelSection
              label="Display"
              action={
                display?.output != null ? (
                  <button
                    type="button"
                    onClick={onViewDisplay}
                    className="border-line text-muted hover:text-primary inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-xs transition-colors"
                    title="view the rendered display"
                  >
                    <Eye size={12} />
                    view rendered
                  </button>
                ) : undefined
              }
            >
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

      {live && (
        <>
          <Balances id={data.address} hideWhenEmpty />
          <OwnedObjects id={data.address} />
          <ObjectTransactions
            id={data.address}
            currentVersion={data.version}
            // Only owned objects have a meaningful per-version owner timeline;
            // shared/immutable ones don't change hands.
            showOwners={!!describeOwner(data.owner).address}
          />
        </>
      )}
    </div>
  )
}
