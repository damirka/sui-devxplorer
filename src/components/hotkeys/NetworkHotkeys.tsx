import type { FixedNetwork } from '@/context/network-context'
import { useNetwork } from '@/context/useNetwork'
import { hotkeyAllowed, shiftedLetter, useKeydown } from '@/lib/hotkeys'

/** Shifted letter → the fixed network it selects. */
const NETWORK_BY_KEY: Record<string, FixedNetwork> = {
  M: 'mainnet',
  T: 'testnet',
  D: 'devnet',
}

/**
 * Headless owner of the network hotkeys: `M` / `T` / `D` switch to mainnet /
 * testnet / devnet from anywhere — the same switch as the header's network
 * menu (`?network=` in the URL, remembered for the next tab). Gated by
 * `hotkeyAllowed` like the rest of the keyboard layer. `custom` has no key: it needs its endpoint typed in.
 */
export function NetworkHotkeys() {
  const { network, setNetwork } = useNetwork()

  useKeydown((e) => {
    if (!hotkeyAllowed(e)) return
    const letter = shiftedLetter(e)
    const next = letter ? NETWORK_BY_KEY[letter] : undefined
    if (!next) return
    e.preventDefault()
    if (next !== network) setNetwork(next)
  })

  return null
}
