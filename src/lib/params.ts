/**
 * The query params that pin a *view* of an id: an object version, a validators
 * tab / focused validator / epoch view, the checkpoints feed. They travel with
 * the id they belong to — dropped when navigating to a new id (`withSearch`),
 * and part of what a bookmark captures. `search` is the id itself and `network`
 * is never a pin.
 */
export const PIN_PARAMS = ['version', 'vtab', 'validator', 'view', 'feed'] as const

export type PinParam = (typeof PIN_PARAMS)[number]

export function isPinParam(key: string): key is PinParam {
  return (PIN_PARAMS as readonly string[]).includes(key)
}

/** Drop every pin from `params` (mutating it) and hand it back. */
export function clearPins(params: URLSearchParams): URLSearchParams {
  for (const k of PIN_PARAMS) params.delete(k)
  return params
}
