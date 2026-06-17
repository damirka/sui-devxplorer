import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/theme/useTheme'
import { Button } from './Button'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      icon
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
    </Button>
  )
}
