import type { ReactNode } from 'react'
import { Header } from './Header'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  )
}
