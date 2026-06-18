import { useSearchParams } from 'react-router-dom'
import { Logo } from './Logo'
import { SearchBar } from '@/components/ui/SearchBar'
import { NetworkSelect } from '@/components/ui/NetworkSelect'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

export function Header() {
  const [searchParams] = useSearchParams()
  const hasSearch = !!searchParams.get('search')

  return (
    <header className="border-line bg-bg/80 sticky top-0 z-40 border-b backdrop-blur-md">
      {/* One fixed-height bar on every route. The compact search slots into the
          middle once you've navigated to a result, but lives *inside* this bar
          (no extra row), so the header height never changes between pages. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Logo className="shrink-0" />

        {hasSearch && (
          <div className="flex min-w-0 flex-1 justify-center">
            <SearchBar variant="compact" />
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <NetworkSelect />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
