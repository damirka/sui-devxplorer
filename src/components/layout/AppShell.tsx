import type { ReactNode } from 'react'
import { Header } from './Header'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg flex min-h-screen flex-col">
      <Header />
      {/* `overflow-x-clip` (not hidden, so it never makes a scroll container or
          breaks sticky) keeps an over-wide row from scrolling the whole page on
          mobile — genuinely wide content has its own `overflow-auto` boxes. */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-x-clip px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  )
}
