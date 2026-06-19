/**
 * A GitHub-style unified diff of two JSON values, used to show how a transaction
 * changed an object's `contents.json`. Both sides are pretty-printed (one value
 * per line, Move-struct style — unquoted keys, no trailing commas), line-diffed
 * via LCS, then formatted into hunks: changed lines (`+`/`-`) with a few lines of
 * surrounding context, long unchanged runs collapsed to a gap marker.
 */

const INDENT = '  '

/**
 * Pretty-print a JSON value to lines. The first line is bare (the caller may
 * prepend a `key: ` prefix); deeper lines are fully indented, with the closing
 * bracket back at `indent`. Keys are unquoted and there are no trailing commas,
 * so a single field change is a single changed line (no comma churn).
 */
function jsonLines(value: unknown, indent: string): string[] {
  if (value === null) return ['null']
  const t = typeof value
  if (t === 'string') return [JSON.stringify(value)]
  if (t !== 'object') return [String(value)]

  if (Array.isArray(value)) {
    if (value.length === 0) return ['[]']
    const inner = indent + INDENT
    const lines = ['[']
    for (const el of value) {
      const sub = jsonLines(el, inner)
      sub[0] = inner + sub[0]
      lines.push(...sub)
    }
    lines.push(indent + ']')
    return lines
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return ['{}']
  const inner = indent + INDENT
  const lines = ['{']
  for (const [k, val] of entries) {
    const sub = jsonLines(val, inner)
    sub[0] = `${inner}${k}: ${sub[0]}`
    lines.push(...sub)
  }
  lines.push(indent + '}')
  return lines
}

/** Pretty-print a value, optionally wrapped under a root `label: …` (e.g. the
 *  object's type), giving the diff a header line for context. */
function prettyJsonLines(value: unknown, label?: string): string[] {
  const lines = jsonLines(value, '')
  if (label) lines[0] = `${label}: ${lines[0]}`
  return lines
}

type Op = { kind: 'eq' | 'del' | 'ins'; text: string }

/** Longest-common-subsequence line diff (classic O(n·m) DP), del/ins biased the
 *  same way `diff` is so unchanged context stays put. */
function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const dp: Int32Array[] = []
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1])
    }
  }
  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'eq', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] })
      i++
    } else {
      out.push({ kind: 'ins', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'ins', text: b[j++] })
  return out
}

export type UnifiedDiffRow =
  | { kind: 'context' | 'add' | 'remove'; text: string }
  | { kind: 'gap'; count: number }

export interface UnifiedDiff {
  rows: UnifiedDiffRow[]
  adds: number
  removes: number
}

/** Collapse the full op list into hunks: keep every change plus `context` lines
 *  around it, replacing longer unchanged runs with a single gap marker. */
function hunkify(ops: Op[], context: number): UnifiedDiffRow[] {
  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, i) => {
    if (op.kind === 'eq') return
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) {
      keep[k] = true
    }
  })

  const rows: UnifiedDiffRow[] = []
  let i = 0
  while (i < ops.length) {
    if (keep[i]) {
      const op = ops[i]
      rows.push({
        kind: op.kind === 'eq' ? 'context' : op.kind === 'del' ? 'remove' : 'add',
        text: op.text,
      })
      i++
    } else {
      let j = i
      while (j < ops.length && !keep[j]) j++
      rows.push({ kind: 'gap', count: j - i })
      i = j
    }
  }
  return rows
}

/** Guard against pathologically large objects — the LCS table is O(n·m). */
const MAX_CELLS = 2_000_000

/**
 * Build a unified diff of `before` → `after`. A `null` side (created/deleted)
 * makes every line an add/remove. Returns `null` when the object is too large to
 * diff inline (caller should fall back); `adds === removes === 0` means the
 * transaction left the contents unchanged.
 */
export function unifiedJsonDiff(
  before: unknown,
  after: unknown,
  opts: { label?: string; context?: number } = {},
): UnifiedDiff | null {
  const context = opts.context ?? 3
  const beforeLines = before == null ? [] : prettyJsonLines(before, opts.label)
  const afterLines = after == null ? [] : prettyJsonLines(after, opts.label)
  if (beforeLines.length * afterLines.length > MAX_CELLS) return null

  const ops = lcsDiff(beforeLines, afterLines)
  return {
    rows: hunkify(ops, context),
    adds: ops.reduce((n, o) => n + (o.kind === 'ins' ? 1 : 0), 0),
    removes: ops.reduce((n, o) => n + (o.kind === 'del' ? 1 : 0), 0),
  }
}
