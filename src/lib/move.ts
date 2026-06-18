/**
 * Shared Move-domain types. A Move function's structured signature shows up in
 * two contexts — a package module's declared function (`MoveFunctionDef`, from
 * the module query) and the function a transaction's MoveCall targets (`MoveFn`)
 * — so the common shape lives here once and each context extends it.
 */

/** A Move function's declared visibility (the GraphQL `MoveVisibility` enum). */
export type MoveVisibility = 'PUBLIC' | 'PRIVATE' | 'FRIEND'

/** The structured signature of a Move function: visibility, type parameters,
 *  and parameter / return type reprs. */
export interface MoveFunctionSignature {
  name: string
  isEntry: boolean | null
  visibility: MoveVisibility | null
  /** Type parameters in declaration order; positional in reprs as `$0`, `$1`, … */
  typeParameters: { constraints: string[] }[]
  /**
   * Parameter types in declaration order. A trailing `&TxContext` is part of the
   * signature but supplied by the runtime, so a call's `arguments` has one fewer
   * entry — pair `arguments[i]` with `parameters[i]` and treat the remainder as
   * runtime-provided.
   */
  parameters: { repr: string }[]
  return: { repr: string }[]
}
