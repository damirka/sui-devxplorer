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
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo className="shrink-0" />

        {/* Compact search appears once the user has navigated to a result */}
        {hasSearch && (
          <div className="hidden flex-1 justify-center md:flex">
            <SearchBar variant="compact" />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <NetworkSelect />
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile compact search row */}
      {hasSearch && (
        <div className="border-line border-t px-4 py-2.5 md:hidden">
          <SearchBar variant="compact" />
        </div>
      )}
    </header>
  )
}
