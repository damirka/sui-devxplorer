/**
 * A minimal structural diff of two JSON values — used to show what a transaction
 * changed in an object's `contents.json`. It recurses into plain objects and
 * arrays down to the leaves, so a change localises (`grid[2][5].variant: 0 → 2`)
 * instead of dumping the whole container. An added or removed subtree is reported
 * as a single entry (not exploded into every leaf), so appending one array
 * element stays one line.
 */
export type JsonChange =
  | { path: string; kind: 'added'; after: unknown }
  | { path: string; kind: 'removed'; before: unknown }
  | { path: string; kind: 'changed'; before: unknown; after: unknown }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Cheap structural equality via canonical JSON. The two values come from the
 *  same Move struct, so key order is stable across before/after. */
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function walk(a: unknown, b: unknown, path: string, out: JsonChange[]): void {
  // A whole subtree appeared / disappeared — report it as one change, don't
  // recurse into every leaf below it.
  if (a === undefined) {
    out.push({ path, kind: 'added', after: b })
    return
  }
  if (b === undefined) {
    out.push({ path, kind: 'removed', before: a })
    return
  }
  if (equal(a, b)) return

  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[key], b[key], path ? `${path}.${key}` : key, out)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      walk(a[i], b[i], `${path}[${i}]`, out)
    }
    return
  }
  // Two differing leaves (or a primitive↔container type change).
  out.push({ path, kind: 'changed', before: a, after: b })
}

/** The leaf-level changes between `before` and `after`, in document order. */
export function diffJson(before: unknown, after: unknown): JsonChange[] {
  const out: JsonChange[] = []
  walk(before, after, '', out)
  return out
}
