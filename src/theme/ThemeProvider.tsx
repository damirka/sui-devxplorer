import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { storedString } from '@/lib/storage'
import { ThemeContext, THEME_STORAGE_KEY, type Theme } from './theme-context'

const themeKey = storedString<Theme>(
  THEME_STORAGE_KEY,
  (v): v is Theme => v === 'dark' || v === 'light',
)

const LIGHT_MQ = '(prefers-color-scheme: light)'

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia(LIGHT_MQ).matches ? 'light' : 'dark'
}

/**
 * Theme = the user's explicit choice (persisted under `devx:theme`) or, until
 * they make one, the OS preference — followed live, so flipping the system to
 * light flips the site too. Only a toggle/set writes storage; seeding it from
 * the OS would freeze the very preference it came from.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Theme | null>(() => themeKey.read())
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = chosen ?? system

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (chosen) return
    const mq = window.matchMedia(LIGHT_MQ)
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [chosen])

  const setTheme = useCallback((next: Theme) => {
    themeKey.write(next)
    setChosen(next)
  }, [])
  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [setTheme, theme],
  )

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
