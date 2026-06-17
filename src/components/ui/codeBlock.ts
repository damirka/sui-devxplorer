/**
 * Shared `<pre>` className for code / disassembly / JSON blocks, so the one
 * surface style (background, border, mono sizing) lives in a single place.
 */
export const CODE_PRE =
  'bg-bg/60 border-line overflow-x-auto border p-4 font-mono text-xs leading-relaxed'

/** Danger variant for error `<pre>` blocks (execution / display errors). */
export const DANGER_PRE =
  'bg-danger/8 border-danger/40 text-danger mt-2 overflow-x-auto border p-4 font-mono text-xs leading-relaxed'
