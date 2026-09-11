/**
 * Safe, typed localStorage. Every access is guarded — storage can be blocked
 * (site data off, sandboxed frames), and then even *reading* throws — and every
 * value goes through a codec on the way in, so a stale or foreign entry never
 * reaches the app as the wrong shape. Keys are `devx:*`.
 */

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Quota / blocked storage: the in-memory value lives for this session only.
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to remove if storage is blocked.
  }
}

/** Cross-tab `storage` events for the keys `match` accepts (`null` = the whole
 *  store was cleared). Returns the unsubscribe. */
export function onStorageChange(
  match: (key: string | null) => boolean,
  listener: (key: string | null) => void,
): () => void {
  const onStorage = (e: StorageEvent) => {
    if (match(e.key)) listener(e.key)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export interface StoredKey<T> {
  readonly key: string
  /** The stored value, or `null` when absent, unreadable or malformed. */
  read(): T | null
  write(value: T): void
  remove(): void
  /** Cross-tab changes to this key (or a whole-store clear). */
  subscribe(listener: () => void): () => void
}

export function storedKey<T>(
  key: string,
  parse: (raw: string) => T | null,
  format: (value: T) => string,
): StoredKey<T> {
  return {
    key,
    read: () => {
      const raw = getItem(key)
      return raw === null ? null : parse(raw)
    },
    write: (value) => setItem(key, format(value)),
    remove: () => removeItem(key),
    subscribe: (listener) => onStorageChange((k) => k === null || k === key, listener),
  }
}

/** A plain-string key limited to a known set — anything else reads as absent. */
export function storedString<T extends string>(
  key: string,
  isValid: (value: string) => value is T,
): StoredKey<T> {
  return storedKey(key, (raw) => (isValid(raw) ? raw : null), (v) => v)
}

/** A free-text key (empty string included). */
export function storedText(key: string): StoredKey<string> {
  return storedKey(key, (raw) => raw, (v) => v)
}

/** A JSON key; `parse` turns the decoded value into `T` (or `null` to reject). */
export function storedJson<T>(key: string, parse: (decoded: unknown) => T | null): StoredKey<T> {
  return storedKey(
    key,
    (raw) => {
      try {
        return parse(JSON.parse(raw))
      } catch {
        return null
      }
    },
    (v) => JSON.stringify(v),
  )
}
