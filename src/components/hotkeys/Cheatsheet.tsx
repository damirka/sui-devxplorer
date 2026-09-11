import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { KeyHints } from '@/components/ui/KeyHints'
import { Modal } from '@/components/ui/Modal'
import { HOTKEYS, hotkeyAllowed, useKeydown } from '@/lib/hotkeys'

/**
 * The `?` popup: every hotkey on the site, from one table (`lib/hotkeys.ts`).
 * `?` toggles it (ignored while typing in a field), esc closes, and a `?`
 * icon button at the header's right edge — the same square as the theme
 * toggle beside it — is the one piece of chrome that points at the keyboard
 * layer. Desktop only: the key hides below `sm` and the hotkey is
 * inert there — no keyboard, nothing to list.
 */
export function Cheatsheet() {
  const [open, setOpen] = useState(false)

  useKeydown((e) => {
    if (e.key !== '?' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    // While we're the open popup the gate says no — but `?` still closes us.
    if (open) {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!hotkeyAllowed(e)) return
    e.preventDefault()
    setOpen(true)
  })

  return (
    <>
      {/* Same square as the theme toggle: an icon button around a 16px glyph box. */}
      <Button
        icon
        onClick={() => setOpen(true)}
        title="keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        className="hidden sm:inline-flex"
      >
        <span aria-hidden className="inline-flex size-4 items-center justify-center">
          ?
        </span>
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="keyboard" className="max-w-lg">
        <div className="flex flex-col gap-5 p-4">
          {HOTKEYS.map((section) => (
            <section key={section.title}>
              <header className="mb-2 flex items-center gap-3">
                <span className="panel-label">{section.title}</span>
                <span className="rule" />
              </header>
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 font-mono text-xs">
                {section.rows.map((row) => (
                  <div key={row.does} className="contents">
                    <dt className="flex flex-wrap items-center gap-1">
                      {row.keys.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-muted">{row.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="border-line flex items-center justify-end border-t px-4 py-2">
          <KeyHints items={[['?', 'toggle'], ['esc', 'close']]} />
        </div>
      </Modal>
    </>
  )
}
