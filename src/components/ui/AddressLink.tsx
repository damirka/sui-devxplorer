import { useEffect, useState } from 'react'
import { Hash } from './Hash'
import { useSearchHref } from './links'
import { useNetwork } from '@/context/useNetwork'
import { atName, defaultSuinsNameCached } from '@/lib/suins'

/**
 * The default SuiNS name of an address (its `.sui` domain), resolved through the
 * shared batched + cached reverse lookup — or taken as given when the caller
 * already has it (`known`, e.g. fetched inline by a list query; pass `null` for
 * a known miss so no lookup runs). `null` while unresolved or when the address
 * has no default name.
 */
export function useSuinsName(address: string | null, known?: string | null): string | null {
  const { network } = useNetwork()
  const [name, setName] = useState<string | null>(known ?? null)
  useEffect(() => {
    if (known !== undefined || !address) {
      setName(known ?? null)
      return
    }
    let active = true
    setName(null)
    defaultSuinsNameCached(network, address).then((n) => {
      if (active) setName(n)
    })
    return () => {
      active = false
    }
  }, [network, address, known])
  return name
}

/**
 * An address as a link to its own page, shown by its default SuiNS name
 * (`@alice`) when it has one and as the truncated id otherwise. The full
 * address stays in the tooltip and is what the copy button copies either way.
 * Pass `name` when the caller already fetched it (a tx list's sender) so no
 * lookup runs; omit it to resolve through the batched cache.
 */
export function AddressLink({
  value,
  name,
  copy = true,
}: {
  value: string
  /** The default SuiNS domain when already known (`null` = known to have none);
   *  `undefined` resolves it lazily. */
  name?: string | null
  copy?: boolean
}) {
  const searchHref = useSearchHref()
  const resolved = useSuinsName(value, name)
  return (
    <Hash
      value={value}
      to={searchHref(value)}
      label={resolved ? atName(resolved) : undefined}
      copy={copy}
    />
  )
}
