import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { RowIndex } from '@/components/ui/RowIndex'
import { HoverCard } from '@/components/ui/HoverCard'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { Muted } from '@/components/ui/Field'
import { useSearchHref } from '@/components/ui/links'
import { truncateMiddle } from '@/lib/search'
import { formatType } from '@/lib/format'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchDynamicFields,
  fetchObjectTypes,
  fetchVersionedInner,
  type DynamicFieldNode,
} from '@/lib/object'

/** A `0x2::versioned::Versioned` field detected on a parent object: the wrapped
 *  Versioned object's id + version. Drives the inner-value fallback below. */
export interface VersionedRef {
  versionedId: string
  version: string | null
}

// A derived object is stored under a dynamic field keyed by
// `0x2::derived_object::Claimed { pos0: ID }` — `pos0` is the derived object's
// id. (Its value is the `ClaimedStatus` marker, which carries no id.)
const DERIVED_KEY = /^0x0{63}2::derived_object::Claimed/

/** Pull the derived object id out of a `Claimed` key's flattened json. */
function derivedId(json: unknown): string | null {
  const id =
    json && typeof json === 'object'
      ? ((json as Record<string, unknown>).pos0 ??
        Object.values(json as Record<string, unknown>)[0])
      : json
  return typeof id === 'string' && /^0x[0-9a-fA-F]{64}$/.test(id) ? id : null
}

/** Where a dynamic field row links, and whether it's a derived-object claim. */
function rowFor(df: DynamicFieldNode): { target: string; derived: string | null } {
  if (DERIVED_KEY.test(df.name.type.repr)) {
    const id = derivedId(df.name.json)
    if (id) return { target: id, derived: id }
  }
  // A dynamic object field points at the stored object; a plain dynamic field
  // resolves only to its wrapper Field object.
  const v = df.value
  return {
    target: v.__typename === 'MoveObject' ? v.address : df.address,
    derived: null,
  }
}

export function DynamicFields({
  id,
  hideWhenEmpty = false,
  versioned = null,
}: {
  id: string
  /** Render nothing once the fetch resolves with no fields (used where the
   * panel would otherwise just be noise, e.g. plain account addresses). */
  hideWhenEmpty?: boolean
  /** When the object has a `Versioned` field and *no* dynamic fields of its own,
   * surface that wrapped inner value (its version + a link to it) in place of the
   * empty panel — the generalised Random/Bridge inner-state shortcut. */
  versioned?: VersionedRef | null
}) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}`,
    (args, signal) => fetchDynamicFields(network, id, args, signal),
  )

  // Derived objects live at a separate id; fetch their concrete types in one
  // batched request so each row can show what kind of object it points at.
  const derivedIds = useMemo(
    () =>
      items.map((df) => rowFor(df).derived).filter((v): v is string => v != null),
    [items],
  )
  const { data: types } = useAsync(
    (signal) => fetchObjectTypes(network, derivedIds, signal),
    [network, derivedIds],
  )

  if (!loading && !error && items.length === 0) {
    // No dynamic fields: if the object wraps its state in a Versioned, show that
    // inner value instead of the empty panel; otherwise honour `hideWhenEmpty`.
    if (versioned) return <VersionedInnerPanel versioned={versioned} />
    if (hideWhenEmpty) return null
  }

  return (
    <Panel>
      <PanelSection
        label="Dynamic fields"
        action={paged ? <Pager {...pagerProps} label="dynamic fields" /> : undefined}
      >
        <DataList
          loading={loading}
          error={error}
          items={items}
          empty="no dynamic fields."
        >
          {(df, i) => {
            const { target, derived } = rowFor(df)
            const derivedType = derived ? types?.get(derived) : null
            const vType = valueType(df)
            // A dynamic *object* field holds a real object — surface its version
            // and pin the row link to it, so you open the object as the field
            // holds it (not just whatever its latest is).
            const objVersion =
              df.value.__typename === 'MoveObject' ? df.value.version : null
            // The key json (`{labels:[…]}`, `2`, …) identifies the entry — but
            // a `dummy_field` marker key carries nothing, so drop it there.
            const keyLabel = isDummyField(df.name.json)
              ? null
              : formatName(df.name.json)
            return (
              <li key={i}>
                <Link
                  to={searchHref(target, objVersion)}
                  title={
                    objVersion != null
                      ? `open ${target} at v${objVersion}`
                      : `open ${target}`
                  }
                  className="hover:bg-surface-2 group -mx-2 flex items-center gap-2 px-2 py-2.5 transition-colors"
                >
                  <RowIndex n={i + 1} />
                  {derived ? (
                    <>
                      <span className="border-line text-muted shrink-0 border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase">
                        derived
                      </span>
                      <span className="text-primary group-hover:underline">
                        {derivedType ? formatType(derivedType) : truncateMiddle(derived)}
                      </span>
                      {derivedType && (
                        <span className="hash text-muted ml-auto shrink-0">
                          {truncateMiddle(derived)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {/* key type → value type (a Field<K,V> entry); the full,
                          un-trimmed types appear in the hover card */}
                      <HoverCard
                        className="min-w-0"
                        card={
                          <TypeHint keyType={df.name.type.repr} valueType={vType} />
                        }
                      >
                        <span className="block truncate group-hover:underline">
                          <span className="text-primary">
                            {formatType(df.name.type.repr)}
                          </span>
                          {vType && (
                            <>
                              <span className="text-muted"> → </span>
                              <span className="text-primary">{formatType(vType)}</span>
                            </>
                          )}
                        </span>
                      </HoverCard>
                      {objVersion != null && (
                        <span
                          className="text-muted shrink-0 tabular-nums"
                          title="object version"
                        >
                          v{objVersion}
                        </span>
                      )}
                      {keyLabel && (
                        <span
                          className="hash text-muted ml-auto max-w-[45%] shrink-0 truncate"
                          title={keyLabel}
                        >
                          {keyLabel}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              </li>
            )
          }}
        </DataList>
      </PanelSection>
    </Panel>
  )
}

/** Shown in place of the (empty) dynamic-fields panel for an object that wraps
 *  its state in a `0x2::versioned::Versioned`: the version, and a link straight to
 *  the wrapped inner value object (labelled with its type), where its fields
 *  render in full. Generalises the Random (0x8) / Bridge (0x9) inner-state path. */
function VersionedInnerPanel({ versioned }: { versioned: VersionedRef }) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const { data: inner, loading } = useAsync(
    (signal) => fetchVersionedInner(network, versioned.versionedId, signal),
    [network, versioned.versionedId],
  )
  return (
    <Panel>
      <PanelSection
        label="Versioned state"
        action={
          versioned.version != null ? (
            <span className="text-muted font-mono text-xs" title="versioned wrapper version">
              v{versioned.version}
            </span>
          ) : undefined
        }
      >
        <p className="text-muted mb-3 text-xs leading-relaxed">
          No dynamic fields of its own — this object holds its state in a{' '}
          <span className="text-text">0x2::versioned::Versioned</span> wrapper. The
          current value:
        </p>
        {loading ? (
          <SkeletonLines count={1} />
        ) : inner ? (
          <Link
            to={searchHref(inner.id)}
            title={`open ${inner.id}`}
            className="hover:bg-surface-2 group -mx-2 flex items-center gap-2 px-2 py-2.5 font-mono text-xs transition-colors"
          >
            <span className="text-primary group-hover:underline">
              {inner.type ? formatType(inner.type) : 'inner value'}
            </span>
            <span className="hash text-muted ml-auto shrink-0 truncate" title={inner.id}>
              {truncateMiddle(inner.id)}
            </span>
          </Link>
        ) : (
          <Muted>could not resolve the inner value.</Muted>
        )}
      </PanelSection>
    </Panel>
  )
}

function formatName(json: unknown): string {
  if (json == null) return '·'
  if (typeof json === 'object') return JSON.stringify(json)
  return String(json)
}

/** Hover-card body: the full, un-trimmed key and value type signatures. */
function TypeHint({
  keyType,
  valueType,
}: {
  keyType: string
  valueType: string | null
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-1">
        <span className="panel-label">key type</span>
        <span className="text-text break-all">{keyType}</span>
      </div>
      {valueType && (
        <div className="flex flex-col gap-1">
          <span className="panel-label">value type</span>
          <span className="text-text break-all">{valueType}</span>
        </div>
      )}
    </div>
  )
}

/** The type a dynamic field stores: a dynamic-object-field's object contents
 * type, or the plain value's MoveType. `null` when unavailable. */
function valueType(df: DynamicFieldNode): string | null {
  const v = df.value
  return v.__typename === 'MoveObject'
    ? (v.contents?.type.repr ?? null)
    : v.type.repr
}

/** A Move "marker" key whose only field is the conventional `dummy_field` bool.
 * Its json (`{dummy_field:false}`) carries no information — show just the type. */
function isDummyField(json: unknown): boolean {
  return (
    !!json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    Object.keys(json as object).length === 1 &&
    'dummy_field' in (json as object)
  )
}
