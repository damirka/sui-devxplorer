import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Logo } from './Logo'
import { SearchBar } from '@/components/ui/SearchBar'
import { SearchModal } from '@/components/ui/SearchModal'
import { NetworkSelect } from '@/components/ui/NetworkSelect'
import { LivenessIndicator } from '@/components/ui/LivenessIndicator'
import { ValidatorsLink } from '@/components/ui/ValidatorsLink'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

export function Header() {
  const [searchParams] = useSearchParams()
  const hasSearch = !!searchParams.get('search')
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <header className="border-line bg-bg/80 sticky top-0 z-40 border-b backdrop-blur-md">
      {/* One fixed-height bar on every route. The compact search slots into the
          middle once you've navigated to a result, but lives *inside* this bar
          (no extra row), so the header height never changes between pages. On a
          narrow screen there's no room for the field — a search icon opens the
          same prompt in a modal instead. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Logo className="shrink-0" />

        {hasSearch && (
          <div className="hidden min-w-0 flex-1 justify-center sm:flex">
            <SearchBar variant="compact" />
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {hasSearch && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="text-muted hover:bg-surface-2 hover:text-primary inline-flex items-center px-1.5 py-1.5 transition-colors sm:hidden"
            >
              <Search size={16} />
            </button>
          )}
          <ValidatorsLink />
          <LivenessIndicator />
          <NetworkSelect />
          <ThemeToggle />
        </div>
      </div>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
