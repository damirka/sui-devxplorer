import { useEffect, useState } from 'react'
import { Diff, Eye, Network as NetworkIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { LinkedHash, TypeLink, useSearchHref, useVersionHref } from '@/components/ui/links'
import { frameworkTagFor, normalizeSuiId } from '@/lib/search'
import { formatTimestamp } from '@/lib/format'
import { JsonTree } from '@/components/ui/JsonTree'
import { CODE_PRE, DANGER_PRE } from '@/components/ui/codeBlock'
import { cn } from '@/lib/cn'
import { Muted } from '@/components/ui/Field'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchObject,
  fetchObjectBounds,
  fetchCreationTx,
  fetchDisplayDefinition,
  fetchTypeDefinition,
  fetchVersionedInner,
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
import { fetchSignerScheme, fetchObjectRemovalTx } from '@/lib/transaction'
import { MvrChip } from './MvrChip'
import { UpgradeCapPanel, upgradeCapData } from './UpgradeCapPanel'
import { OwnedUpgradeCaps } from './OwnedUpgradeCaps'
import { Balances } from './Balances'
import { DisplayModal } from './DisplayModal'
import {
  fetchDefaultSuinsName,
  atName,
  isSuinsType,
  SUINS_REGISTRATION_MVR,
} from '@/lib/suins'
import { isStakedSuiType } from '@/lib/staking'
import { resolveMvrType } from '@/lib/mvr'
import {
  StructDeclaration,
  innerValueSignature,
  innerKeySignature,
  reprFromSignature,
} from './moveType'

// The Sui system state at 0x5 gets a full callout — it backs the validators
// dashboard, which the callout links to. Its inner value (the versioned
// `SuiSystemStateInnerV2` that actually holds the validator set) has a fixed,
// every-network id and gets the same callout.
const SYSTEM_STATE_ID = normalizeSuiId('5')
const SYSTEM_STATE_INNER_ID = normalizeSuiId(
  '5b890eaf2abcfa2ab90b77b8e6f3d5d8609586c3e583baf3dccd5af17edf48d1',
)
// The bridge object 0x9 — kept only for the `paused` header badge, which reads a
// bridge-specific field of its inner state. Its header tag (and the inner-value
// panel below) are handled generically, by id-agnostic detection.
const BRIDGE_ID = normalizeSuiId('9')

// An object's `0x2::versioned::Versioned` field — matched in any zero-padded form.
// Such an object keeps its real state in the Versioned's single dynamic field one
// hop deeper, so (when it has no dynamic fields of its own) we surface that inner
// value in place of an empty dynamic-fields panel. See `DynamicFields`.
const VERSIONED_TYPE = /^0x0*2::versioned::Versioned$/

/** Find a `Versioned` field in an object's struct definition + flattened
 *  contents: its wrapped object id and version. `null` when there is none. */
function versionedField(
  typeDef: { fields: { name: string; type: { repr: string } }[] } | null,
  json: unknown,
): { versionedId: string; version: string | null } | null {
  const field = typeDef?.fields.find((f) => VERSIONED_TYPE.test(f.type.repr))
  if (!field) return null
  const v = (json as Record<string, unknown> | null | undefined)?.[field.name] as
    | { id?: unknown; version?: unknown }
    | undefined
  const id = typeof v?.id === 'string' ? v.id : null
  if (!id) return null
  const version =
    v?.version != null && (typeof v.version === 'string' || typeof v.version === 'number')
      ? String(v.version)
      : null
  return { versionedId: id, version }
}

/** Pull a SuiNS registration's domain + expiry out of its Move contents. */
function suinsFields(json: unknown): { domain: string | null; expirationMs: number | null } {
  const j = (json ?? {}) as { domain_name?: unknown; expiration_timestamp_ms?: unknown }
  const domain = typeof j.domain_name === 'string' ? j.domain_name : null
  const raw = j.expiration_timestamp_ms
  const ms = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return { domain, expirationMs: Number.isFinite(ms) ? ms : null }
}

/** The one-line note shown under the header for a SuiNS registration: the domain
 *  and its expiry as a readable timestamp (red once past). */
function SuinsNote({
  domain,
  expirationMs,
  now,
}: {
  domain: string | null
  expirationMs: number | null
  now: number
}) {
  const expired = expirationMs != null && expirationMs < now
  return (
    <div className="border-line bg-surface-2 mb-6 border px-4 py-3 font-mono text-xs">
      <p className="text-muted leading-relaxed">
        {domain ? <span className="text-primary">{domain}</span> : 'A SuiNS name'} — a
        SuiNS name registration.
        {expirationMs != null && (
          <>
            {' '}
            {expired ? (
              <span className="text-danger">expired</span>
            ) : (
              'expires'
            )}{' '}
            <span className={expired ? 'text-danger' : 'text-text'}>
              {formatTimestamp(new Date(expirationMs).toISOString())}
            </span>
            .
          </>
        )}
      </p>
    </div>
  )
}

type SystemVariant = 'object' | 'inner'

/** The system-state callout shown atop 0x5 / its inner value: a tag, which body
 *  to render, and a nudge to the validators dashboard. `null` for anything else
 *  (other framework objects are marked with a header tag, not a callout). */
function systemHintFor(value: string): { tag: string; variant: SystemVariant } | null {
  if (value === SYSTEM_STATE_ID) return { tag: 'system state', variant: 'object' }
  if (value === SYSTEM_STATE_INNER_ID)
    return { tag: 'system state · inner', variant: 'inner' }
  return null
}

/** The 0x5 system-state callout (its tag sits in the header). A one-line
 *  description — the "validator set" phrase itself links to the dashboard — with
 *  a "view validators →" action on the right. */
function SystemObjectHint({ variant }: { variant: SystemVariant }) {
  const searchHref = useSearchHref()
  const setLink = (text: string) => (
    <Link to={searchHref('validators')} className="text-primary hover:underline">
      {text}
    </Link>
  )
  return (
    <div className="border-primary/40 bg-primary/5 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3 font-mono text-xs">
      <NetworkIcon size={13} className="text-primary shrink-0" />
      <p className="text-muted min-w-0 flex-1 leading-relaxed">
        {variant === 'object' ? (
          <>
            The on-chain home of the {setLink('validator set')}, current epoch,
            reference gas price, and staking parameters.
          </>
        ) : (
          <>
            0x5's dynamic field (SuiSystemStateInnerV2) — the full{' '}
            {setLink('validator set')}, total stake, and epoch parameters.
          </>
        )}
      </p>
      <Link
        to={searchHref('validators')}
        className="text-primary shrink-0 font-semibold whitespace-nowrap hover:underline"
      >
        view validators →
      </Link>
    </div>
  )
}

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
  // Nudge toward the validators dashboard when this is 0x5 or its inner state.
  const systemHint = systemHintFor(value)
  // A terse "what is this" tag for well-known framework objects/packages.
  const frameworkTag = frameworkTagFor(value)
  // A SuiNS registration NFT — tagged, with its expiry surfaced below the header.
  // Strict: the object's type must equal the MVR-resolved `@suins/core/1` type
  // for this network. The `module::struct` regex is only a cheap gate so we don't
  // resolve MVR on every object page; the equality check is the actual verdict.
  const objType = obj?.asMoveObject?.contents?.type.repr ?? null
  const looksSuins = isSuinsType(objType)
  const suinsType = useAsync(
    (signal) =>
      looksSuins ? resolveMvrType(network, SUINS_REGISTRATION_MVR, signal) : Promise.resolve(null),
    [network, looksSuins],
  )
  const suins =
    objType != null && suinsType.data != null && objType === suinsType.data
      ? suinsFields(obj?.asMoveObject?.contents?.json)
      : null
  // A package is just an immutable object, but it reads as a "package" to a
  // dev — so once loaded, badge it as one. Unknown until the fetch resolves.
  const isPackage = !!obj?.asMovePackage
  // A pinned version that resolves to nothing is a bad version, not an address.
  const missingVersion = version != null && !loading && !error && data != null && !obj
  // Nothing resolved at this id as a live top-level object — it's one of two
  // things, and object ids / account addresses share a shape so we can't tell
  // from the id alone. Probe the id's *version history*: a non-empty history
  // means it once existed as an object (now deleted, or wrapped inside another
  // object), so we surface that history instead of dead-ending. An empty history
  // means it's a plain account address. (Not when a version is pinned — that's a
  // specific object lookup, handled above.)
  const noObject = version == null && !loading && !error && data != null && !obj
  // One round-trip probes both ends of the version connection: existence (does it
  // have any version → was it an object?), its latest version (to pin the
  // last-known-state snapshot), and its creating tx (first version's producing tx).
  const bounds = useAsync(
    (signal) =>
      noObject ? fetchObjectBounds(network, value, signal) : Promise.resolve(null),
    [network, value, noObject],
  )
  // Still probing — hold off on committing to address vs. object.
  const probingHistory = noObject && bounds.loading
  const boundsDone = noObject && !bounds.loading
  // A deleted / wrapped object: gone from the live set but with on-chain history.
  const isDeletedObject = boundsDone && (bounds.data?.exists ?? false)
  // Fall through to "account address" once the probe comes back with no versions
  // (or errors — the safe default is the address view).
  const isAddress = boundsDone && !isDeletedObject

  // A deleted/wrapped object is gone from *latest*, but its last state is still
  // queryable by pinning to its final version (from the probe). So we can show
  // what it *was* — its type, contents, and owner-at-deletion.
  const lastVersion = bounds.data?.lastVersion ?? null
  const snapshot = useAsync(
    (signal) =>
      isDeletedObject && lastVersion != null
        ? fetchObject(network, value, lastVersion, signal)
        : Promise.resolve(null),
    [network, value, isDeletedObject, lastVersion],
  )
  const snapObj = snapshot.data?.object ?? null
  const snapType = snapObj?.asMoveObject?.contents?.type.repr ?? null
  const snapContents = snapObj?.asMoveObject?.contents?.json
  // Creating tx (first version) for the deleted object's overview lineage — comes
  // free from the same bounds probe.
  const deletedCreatedTx = bounds.data?.createdTx ?? null

  // The transaction that removed it (deleted / wrapped): the last one to affect
  // the object. `null` once resolved means its history has aged out of the
  // endpoint's `affectedObject` retention window, so it can't be looked up here.
  const removal = useAsync(
    (signal) =>
      isDeletedObject ? fetchObjectRemovalTx(network, value, signal) : Promise.resolve(null),
    [network, value, isDeletedObject],
  )

  // An address carries no on-chain marker for how it signs — the only signal is
  // a transaction it authored. Probe for it once we know this id is an address,
  // so we can badge the scheme (Ed25519 / multisig / zkLogin / passkey / …) and
  // show its detail. Skipped for objects/packages (resolves null, no request).
  const signer = useAsync(
    (signal) =>
      isAddress ? fetchSignerScheme(network, value, signal) : Promise.resolve(null),
    [network, value, isAddress],
  )

  // On the bridge object (0x9), read its inner `paused` flag so the header can
  // badge whether transfers are live or halted. 0x9 wraps its state in an
  // `inner: Versioned`; resolve that Versioned's value object and read `paused`.
  // Only runs on the bridge page, once the object's contents are loaded.
  const bridgeVersionedId =
    value === BRIDGE_ID
      ? (() => {
          const inner = (
            obj?.asMoveObject?.contents?.json as { inner?: { id?: unknown } } | undefined
          )?.inner?.id
          return typeof inner === 'string' ? inner : null
        })()
      : null
  const bridge = useAsync(
    async (signal) => {
      if (!bridgeVersionedId) return null
      const inner = await fetchVersionedInner(network, bridgeVersionedId, signal)
      return inner ? fetchObject(network, inner.id, null, signal) : null
    },
    [network, bridgeVersionedId],
  )
  const bridgePaused: boolean | null = (() => {
    if (value !== BRIDGE_ID) return null
    const json = bridge.data?.object?.asMoveObject?.contents?.json as
      | { value?: { paused?: unknown } }
      | undefined
    const p = json?.value?.paused
    return typeof p === 'boolean' ? p : null
  })()

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
          <>
            {frameworkTag && <Badge>{frameworkTag}</Badge>}
            {systemHint && <Badge>{systemHint.tag}</Badge>}
            {isDeletedObject && (
              <Badge tone="danger" title="no longer in the live object set — deleted, or wrapped inside another object">
                deleted
              </Badge>
            )}
            {isStakedSuiType(objType) && <Badge>staked sui</Badge>}
            {suins && <Badge kind="suins">suins</Badge>}
            {bridgePaused != null && (
              <Badge
                tone={bridgePaused ? 'danger' : undefined}
                title={
                  bridgePaused
                    ? 'the bridge is paused — token transfers are halted'
                    : 'the bridge is active — token transfers are live'
                }
              >
                {bridgePaused ? 'paused' : 'active'}
              </Badge>
            )}
            {(isPackage || mvrName) && (
              <MvrChip packageId={value} knownName={mvrName} />
            )}
            {domain && <Badge kind="suins">{atName(domain)}</Badge>}
            {signer.data && <Badge>{signer.data.scheme}</Badge>}
            {obj && !isPackage && version != null && <Badge>v{obj.version}</Badge>}
          </>
        }
      />

      {systemHint && <SystemObjectHint variant={systemHint.variant} />}

      {suins && (
        <SuinsNote domain={suins.domain} expirationMs={suins.expirationMs} now={Date.now()} />
      )}

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

      {probingHistory && (
        <Panel>
          <PanelSection>
            <SkeletonLines count={4} />
          </PanelSection>
        </Panel>
      )}

      {isDeletedObject && (
        <div className="space-y-6">
          <div className="border-danger/40 bg-danger/5 space-y-1.5 border px-4 py-3 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-danger font-semibold tracking-wider uppercase">deleted</span>
              <span className="text-muted">
                no longer in the live set. its last known state
                {lastVersion != null ? ` (v${lastVersion})` : ''} and transaction history
                are below.
              </span>
            </div>
            <div className="text-muted">
              {removal.loading ? (
                <span className="opacity-60">locating the transaction that removed it…</span>
              ) : removal.data ? (
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  <span>{removal.data.deleted ? 'deleted in' : 'removed in'}</span>
                  <LinkedHash value={removal.data.digest} />
                  {removal.data.timestamp && (
                    <span className="text-muted/70">· {formatTimestamp(removal.data.timestamp)}</span>
                  )}
                </span>
              ) : (
                <span className="text-muted/80">
                  the removing transaction isn't available — it has aged out of this
                  endpoint's transaction-index retention window.
                </span>
              )}
            </div>
          </div>

          {/* Last known state, recovered by pinning to the final version. */}
          {snapObj ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ObjectOverview
                data={snapObj}
                type={snapType ? <TypeLink type={snapType} copy /> : undefined}
                createdTx={deletedCreatedTx}
                deletedTx={removal.data?.digest ?? null}
              />
              {snapContents != null && (
                <Panel>
                  <PanelSection label="Fields · last version">
                    <JsonTree value={snapContents} copy />
                  </PanelSection>
                </Panel>
              )}
            </div>
          ) : snapshot.loading ? (
            <Panel>
              <PanelSection label="Last known state">
                <SkeletonLines count={4} />
              </PanelSection>
            </Panel>
          ) : null}

          {/* A wrapped object (also object()==null) can still hold dynamic fields
              / own objects / carry balances — surface them when present. */}
          <DynamicFields id={value} hideWhenEmpty />
          <Balances id={value} hideWhenEmpty />
          <OwnedObjects id={value} hideWhenEmpty />
          {/* Versions + the txs that touched it — the same panels a live object
              gets. Each version links to its snapshot (pinned-version query). */}
          <ObjectHistory id={value} currentVersion={lastVersion} />
          <ObjectTransactions id={value} currentVersion={null} removal={removal.data} />
        </div>
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
  // Only owned (address/object-owned) objects have a meaningful per-version owner
  // timeline; shared/immutable ones never change hands. Used by the version /
  // transactions panels below.
  const ownedByAddress = !!describeOwner(data.owner).address

  // The tx that created this object (its first version), for the overview's tx
  // lineage — the same regardless of which version is being viewed.
  const creation = useAsync(
    (signal) => fetchCreationTx(network, data.address, signal),
    [network, data.address],
  )

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
    [network, defSig],
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
  // A `0x2::versioned::Versioned` field means this object's real state is one hop
  // deeper. When it has no dynamic fields of its own, the dynamic-fields panel
  // surfaces that inner value instead (see `DynamicFields`). Detected from the
  // struct definition + contents — no extra fetch.
  const versioned = versionedField(typeDef.data, move?.contents?.json)

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
        <ObjectOverview data={data} type={typeField} createdTx={creation.data} />

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
          showOwners={ownedByAddress}
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

        {/* Dynamic fields resolve to the live object only — hide on a snapshot.
            When the object wraps its state in a `Versioned` and has no dynamic
            fields of its own, the panel surfaces that inner value instead. */}
        {live && <DynamicFields id={data.address} versioned={versioned} />}
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
                def.data ? (
                  <span className="flex items-center gap-3">
                    <span
                      title={
                        def.data.legacy
                          ? '0x2::display::Display<T> (legacy)'
                          : '0x2::display_registry::Display<T> (V2)'
                      }
                    >
                      <Badge tone="muted">
                        {def.data.legacy ? 'legacy' : 'V2'}
                      </Badge>
                    </span>
                    <LinkedHash value={def.data.address} />
                  </span>
                ) : undefined
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
                      <ExpandableText text={f.value} className="text-muted min-w-0" />
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
            showOwners={ownedByAddress}
          />
        </>
      )}
    </div>
  )
}
