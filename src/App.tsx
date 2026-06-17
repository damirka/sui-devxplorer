import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { NetworkProvider } from '@/context/NetworkProvider'
import { AppShell } from '@/components/layout/AppShell'
import { Home } from '@/pages/Home'

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <NetworkProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </NetworkProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
