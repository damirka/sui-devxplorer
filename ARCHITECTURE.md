# Architecture & agent notes

Orientation for anyone (human or agent) working in this repo. Keep it current.

## What this is

A **search-first**, **backend-free** Sui explorer SPA. Everything begins at one
search bar; the URL is the source of truth. Data will come exclusively from the
**Sui GraphQL API** (`https://graphql.mainnet.sui.io/graphql`) — there is no
server and no REST layer to add.

## Mental model: the URL is the state

There is effectively one route, `/` (`src/App.tsx`). What renders is decided by
query params, not by the path:

- `?search=<value>` — the thing being viewed. Absent → landing prompt.
- `?network=<mainnet|testnet|devnet|localnet>` — omitted when `mainnet`.

`src/pages/Home.tsx` reads `?search`; empty → `Hero`, otherwise → `ResultRouter`.
`src/lib/search.ts#detectSearchKind()` classifies the raw string (address /
object / transaction / package / unknown) and `ResultRouter` picks the view.
**Any state worth sharing goes in the URL** via `useSearchParams` — never local
component state that a reload would lose. This is what makes every view a
shareable link and keeps the back button working.

## Layout of the code

```
src/
  App.tsx                 one route + provider nesting (Router > Theme > Network > AppShell)
  main.tsx                entry; imports styles/index.css
  styles/index.css        THE design system (see below)
  lib/
    search.ts             detectSearchKind(), normalizeSuiId(), truncateMiddle()  ← pure, test here
    mvr.ts                Move Registry REST client (names ↔ packages, versions) — not GraphQL
    cn.ts                 clsx + tailwind-merge
  theme/                  data-theme on <html>; ThemeProvider + useTheme (split for fast-refresh)
  context/                NetworkProvider — network lives in ?network=, seeded from localStorage
  components/
    ui/                   design-system primitives (Button, Panel, Badge, Hash, SearchBar, …)
    layout/               AppShell (Header + <main>), Header, Logo
  pages/
    Home.tsx, Hero.tsx
    results/              ObjectView, TransactionView, PackageView, SuinsView, MvrView, NotFound
                          + ResultRouter (dispatch), ResultHeader, ObjectOverview,
                            PackageBody/PackageModules/PackageDependencies/PackageDependents,
                            moveType, SuinsNames, MvrPanel/MvrChip, OwnedObjects,
                            DynamicFields, Txs
```

Providers are split into `*-context.ts` (createContext) + `*Provider.tsx` +
`use*.ts` hook so React Fast Refresh stays happy — keep that pattern.

## Styling: design tokens + custom classes, not utility soup

`src/styles/index.css` is Tailwind v4, CSS-first. The look is **Matrix phosphor
green + Sifu brutalist structure**: mono-forward, sharp edges (radius token is
`0`), one signal hue (phosphor green) and one alarm hue (red, failures/errors
only). Three layers:

1. `@theme` — static palette + fonts; `--radius-card: 0` (no rounding anywhere).
2. `@layer base` — **semantic CSS variables** defined twice: `:root` (dark) and
   `:root[data-theme="light"]` (inverted). `@theme inline` maps them to utilities
   (`bg-surface`, `text-muted`, `border-line`, `text-primary`, …) so components
   are theme-agnostic. `body` is `font-mono` by default.
3. `@layer components` — the reusable classes: `.btn`/`.btn-primary`/`.btn-ghost`,
   `.input`, `.panel`, the section-header trio `.panel-index` + `.panel-label`
   (uppercase, tracked) + `.rule` (the flexing divider), the indexed list
   primitives `.menu-row` + `.menu-num`, `.badge` (+ `.badge-danger`/`.badge-muted`),
   `.kbd`, `.hash`, `.skeleton`, `.glow`, `.term-caret`.

**When adding UI:** reach for a semantic utility or an existing component class
first. Add a new `@layer components` class for anything reused; never hard-code
hex colors in TSX — every colour goes through a token. Theme by setting
`data-theme`, never by toggling per-color classes. Keep edges sharp (no
`rounded-*`).

## Conventions that matter

- **Two registers.** Structural chrome is **UPPERCASE, tracked** (Sifu menu):
  `.panel-label` section headers and `.badge` type tags uppercase via CSS. Actual
  **content/copy stays lowercase** terminal-vibe (placeholders, statuses, helper
  text). Don't uppercase user data.
- **Minimal by default.** The owner repeatedly stripped chrome (grid bg, footer,
  logo icon, marketing copy, examples, type-legend). Don't reintroduce
  decoration; green = signal, red = alarm — never ornament. No background effects
  (no Matrix rain / scanlines): the vibe comes from the palette + mono + the
  block caret, not motion.
- **Identifiers** render through `<Hash>` (truncated middle + copy). Normalize
  ids with `normalizeSuiId`.
- **Keyboard:** `/` and `Tab` focus the search globally (see `SearchBar`); the
  hero caret is a custom overlay because native carets can't be thickened.

## Move Registry (MVR): a second data source

GraphQL isn't the only backend-free source. `lib/mvr.ts` talks to the **Move
Registry REST API** (`https://<network>.mvr.mystenlabs.com`, mainnet + testnet
only — no devnet) to map packages ↔ human-readable names:

- **reverse** (`/v1/reverse-resolution/bulk`) — a package id → its `@ns/app`
  name. Works for *any* version in the upgrade chain. `MvrPanel` (top of
  `PackageBody`) does this for every package view; renders nothing when unnamed.
- **forward** (`/v1/resolution/bulk`) — `@ns/app` (or versioned `@ns/app/3`) →
  package id. `detectSearchKind` classifies an `@`-token *containing `/`* as
  `mvr` (a slash-free `@handle` stays SuiNS); `MvrView` resolves it and delegates
  to `ObjectView`, the same way `SuinsView` does.
- **metadata + versions** (`/v1/names/{name}`) — description/links + the latest
  version number; `MvrPanel` then bulk-resolves `@name/1..N` for the full version
  list (each linked to its package page). **Bulk endpoints cap at 50 names** — chunk.
- **dependencies** — `PackageDependencies` reads a package's on-chain `linkage`
  (GraphQL, `fetchPackageLinkage`), drops the framework (0x1/0x2/0x3/0xb), and
  bulk-reverse-resolves the rest (`reverseResolveMvrBulk`) to show an MVR name
  where one exists (best-effort — most deps have no reverse mapping) + the
  on-chain version + a link to the exact linked id.
- **dependents** — `PackageDependents` reads `/package-address/{id}/dependents`
  (`fetchMvrDependents`), ordered by call volume; cursor-paginated via the shared
  `useCursorPager`/`Pager` (MVR's base64 `next_cursor` → the pager's `endCursor`,
  `limit` ≤ 50). Each page's ids are bulk-reverse-resolved for names. MVR-only,
  so it renders nothing on devnet.

CORS is open (`*`). All of MVR sits behind `mvrSupported(network)`.

## The SearchBar overlay (so you don't "fix" it by accident)

The hero variant fakes a thick block caret: the real `<input>` is rendered with
transparent text + transparent native caret, a mirror `<div>` shows the value (or
placeholder), and a `.term-caret` block is **pinned after the `❯`, outside the
scrolling text region** so value and placeholder share the same left origin. The
mirror is `translateX`-synced to the input's `scrollLeft` so long ids stay
aligned. Touch this layer carefully.

## Next: wiring GraphQL

No client yet. When adding one (likely `@tanstack/react-query` + a thin fetch, or
dapp-kit), key queries by `(network, kind, value)`, read those from the URL, and
fill the placeholder sections in `pages/results/*`. Endpoint per network:
`https://graphql.<network>.sui.io/graphql`. Query recipes (package linkage,
modules, disassembly, type origins, object/tx lookups, pagination caveats) are in
the agent memory note `sui-graphql-package-api`.

## Verify

`pnpm build` must pass (typecheck + bundle). Smoke test: `pnpm dev`, confirm the
prompt centers, theme toggle persists, typing a `0x…`/digest/`::` updates
`?search=` and renders the right placeholder view, and reloading that URL
restores it.
