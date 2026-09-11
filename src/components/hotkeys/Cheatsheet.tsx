import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { HOTKEYS, isEditableTarget } from '@/lib/hotkeys'

/**
 * The `?` popup: every hotkey on the site, from one table (`lib/hotkeys.ts`).
 * Headless until opened — `?` toggles it (ignored while typing in a field),
 * esc closes. No chrome points at it; `?` is the convention devs already try.
 */
export function Cheatsheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '?' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
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
    </Modal>
  )
}
