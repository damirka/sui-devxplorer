import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { EntityLink } from './links'
import { CopyButton } from './CopyButton'
import { CODE_PRE } from './codeBlock'

/**
 * In a pretty-printed JSON string, every address/object-id (Address, ID, UID —
 * all flatten to a full `0x` + 64-hex string) becomes a link to its own page.
 * Other scalars (u64 strings, bools) never match the pattern.
 */
const ADDRESS_IN_JSON = /0x[0-9a-fA-F]{64}/g

export function linkifyAddresses(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  ADDRESS_IN_JSON.lastIndex = 0
  while ((m = ADDRESS_IN_JSON.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<EntityLink key={m.index} id={m[0]} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Pretty-printed JSON with every id linkified, clamped to `maxLines` with a
 * click-to-expand toggle.
 */
export function JsonBlock({
  value,
  maxLines = 20,
  copy = false,
}: {
  value: unknown
  maxLines?: number
  copy?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const full = JSON.stringify(value, null, 2)
  const lines = full.split('\n')
  const clamped = lines.length > maxLines
  const shown = !clamped || expanded ? full : lines.slice(0, maxLines).join('\n')

  return (
    <div>
      <div className="relative">
        {copy && (
          <CopyButton
            value={full}
            label="Copy fields"
            className="bg-bg/80 border-line absolute top-2 right-2 border p-1.5"
          />
        )}
        <pre className={CODE_PRE}>
          <code>{linkifyAddresses(shown)}</code>
        </pre>
      </div>
      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-muted hover:text-primary mt-2 inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp size={13} />
              show less
            </>
          ) : (
            <>
              <ChevronDown size={13} />
              show full ({lines.length} lines)
            </>
          )}
        </button>
      )}
    </div>
  )
}
