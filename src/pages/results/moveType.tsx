import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSearchHref } from '@/components/ui/links'
import { CODE_PRE } from '@/components/ui/codeBlock'
import { formatType, FRAMEWORK_PREFIX } from '@/lib/format'
import type { TypeDefinition } from '@/lib/object'

/**
 * A node in a Move type signature tree. Covers both the concrete
 * `MoveType.signature` (object contents) and the abstract
 * `OpenMoveTypeSignature` body (struct fields, which add `typeParameter`).
 */
export type SigNode =
  | string
  | { typeParameter?: number; vector?: SigNode; datatype?: DatatypeSig }
export interface DatatypeSig {
  package: string
  module: string
  type: string
  typeParameters?: SigNode[]
}

/**
 * If a signature is a dynamic-field wrapper (`0x2::dynamic_field::Field<K, V>`),
 * return the value type `V`'s signature; otherwise `null`.
 */
export function innerValueSignature(signature: unknown): SigNode | null {
  const dt = (signature as { datatype?: DatatypeSig } | null)?.datatype
  if (!dt || dt.module !== 'dynamic_field' || dt.type !== 'Field') return null
  return dt.typeParameters?.[1] ?? null
}

/**
 * If a signature is a dynamic-field wrapper (`0x2::dynamic_field::Field<K, V>`),
 * return the key type `K`'s signature; otherwise `null`.
 */
export function innerKeySignature(signature: unknown): SigNode | null {
  const dt = (signature as { datatype?: DatatypeSig } | null)?.datatype
  if (!dt || dt.module !== 'dynamic_field' || dt.type !== 'Field') return null
  return dt.typeParameters?.[0] ?? null
}

/** Rebuild a full type repr (with full addresses) from a signature node. */
export function reprFromSignature(sig: SigNode): string {
  if (typeof sig === 'string') return sig
  if (sig.typeParameter !== undefined) return `$${sig.typeParameter}`
  if (sig.vector) return `vector<${reprFromSignature(sig.vector)}>`
  const dt = sig.datatype
  if (!dt) return '?'
  const params = dt.typeParameters?.length
    ? `<${dt.typeParameters.map(reprFromSignature).join(', ')}>`
    : ''
  return `${dt.package}::${dt.module}::${dt.type}${params}`
}

/**
 * Display name for a single datatype: framework types (`0x2::object::UID`,
 * `0x1::string::String`) collapse to bare names (`UID`, `String`); custom-package
 * types keep a trimmed address. Generics are rendered separately.
 */
function datatypeName(dt: DatatypeSig): string {
  const base = `${dt.package}::${dt.module}::${dt.type}`
  return formatType(base.replace(FRAMEWORK_PREFIX, ''))
}

/** The `struct Name<T..>: has .. {` header line (no clickable parts). */
function structHeader(def: TypeDefinition): string {
  const params = def.typeParameters.length
    ? `<${def.typeParameters
        .map((tp, i) => {
          const head = `${tp.isPhantom ? 'phantom ' : ''}T${i}`
          return tp.constraints.length
            ? `${head}: ${tp.constraints.map((c) => c.toLowerCase()).join(' + ')}`
            : head
        })
        .join(', ')}>`
    : ''
  const abilities = def.abilities.length
    ? ` has ${def.abilities.map((a) => a.toLowerCase()).join(', ')}`
    : ''
  return `struct ${def.name}${params}${abilities} {`
}

/**
 * Render a field's type from its signature tree, with every datatype a link to
 * its own type page. Framework names are bared; positional params show as `Tn`.
 */
function FieldTypeSig({
  sig,
  searchHref,
}: {
  sig: SigNode
  searchHref: (value: string) => string
}): ReactNode {
  if (typeof sig === 'string') return sig
  if (sig.typeParameter !== undefined) return `T${sig.typeParameter}`
  if (sig.vector) {
    return (
      <>
        vector&lt;
        <FieldTypeSig sig={sig.vector} searchHref={searchHref} />
        &gt;
      </>
    )
  }
  const dt = sig.datatype
  if (!dt) return '?'
  const target = `${dt.package}::${dt.module}::${dt.type}`
  return (
    <>
      <Link
        to={searchHref(target)}
        title={target}
        className="text-primary hover:underline"
      >
        {datatypeName(dt)}
      </Link>
      {dt.typeParameters?.length ? (
        <>
          &lt;
          {dt.typeParameters.map((p, i) => (
            <Fragment key={i}>
              {i > 0 ? ', ' : ''}
              <FieldTypeSig sig={p} searchHref={searchHref} />
            </Fragment>
          ))}
          &gt;
        </>
      ) : null}
    </>
  )
}

/** A struct definition as Move-like source; datatypes are clickable links. */
export function StructDeclaration({ def }: { def: TypeDefinition }) {
  const searchHref = useSearchHref()
  return (
    <pre className={CODE_PRE}>
      <code>
        {structHeader(def)}
        {def.fields.length === 0
          ? '}'
          : def.fields.map((f, i) => (
              <Fragment key={i}>
                {`\n  ${f.name}: `}
                <FieldTypeSig
                  sig={fieldSigBody(f.type.signature)}
                  searchHref={searchHref}
                />
                {','}
                {i === def.fields.length - 1 ? '\n}' : ''}
              </Fragment>
            ))}
      </code>
    </pre>
  )
}

/** Unwrap an `OpenMoveTypeSignature` (`{ body }`) to its node, defensively. */
function fieldSigBody(signature: unknown): SigNode {
  const body = (signature as { body?: SigNode } | null)?.body
  return body ?? '?'
}
