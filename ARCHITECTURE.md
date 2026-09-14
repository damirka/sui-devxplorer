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
- `?network=<mainnet|testnet|devnet|custom>` — always present on a result page
  (mainnet included, so a copied link is unambiguous); absent on the landing
  page. `NetworkProvider` normalises a URL that breaks the rule.
- Dashboard sub-state rides along too: `?feed=txs` flips the live checkpoints
  view (`search=checkpoints`) to its programmable-transactions feed; the
  validators view keeps its tab / opened row in `vtab`, `validator`, `view`;
  an address's owned-objects view keeps its filter and status facet in
  `owned` / `facet` (so back from a row lands on the list, scrolled to it).
  `withSearch()` (in `components/ui/links.tsx`) drops all of these when
  navigating to another entity — add any new dashboard param there.

`src/pages/Home.tsx` reads `?search`; empty → `Hero`, otherwise → `ResultRouter`.
`src/lib/search.ts#detectSearchKind()` classifies the raw string (address /
object / transaction / package / unknown) and `ResultRouter` picks the view.
Keywords resolve there too: framework objects (`clock`, `random`, …), framework
types (`sui` → `0x2::sui::SUI`), dashboards, and per-network aliases
(`lib/aliases.ts`: `usdc` → the network's native USDC type, `walrus-system`,
`wal`, … — the keyword stays in the URL and `AliasView` resolves it against
the active network, so a bookmark follows the network switch).
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
    transaction.ts        fetchTransaction(): effects from GraphQL; the definition (inputs,
                          commands, gas) decoded locally from `transactionBcs` — see
                          "Transaction bytes" below
    program.ts            the Program panel's copy forms (script / TS SDK / `sui client ptb`)
    allowance.ts          native allowances (0x2::allowance): type predicates, Move-JSON parser,
                          status, and the funder → allowances join (AllowanceCap → extract →
                          asAddress → asObject, one request per 50 caps)
    bookmarks.ts          per-network localStorage bookmark store (useSyncExternalStore) + page identity
    hotkeys.ts            the hotkey table behind the `?` cheatsheet, the gate + useKeydown
    storage.ts            guarded, typed localStorage keys (theme, network, bookmarks use it)
    params.ts             PIN_PARAMS — the view pins links drop and bookmarks keep
    cn.ts                 clsx + tailwind-merge
  theme/                  data-theme on <html>; ThemeProvider + useTheme (split for fast-refresh)
  context/                NetworkProvider — network lives in ?network=, seeded from localStorage
  components/
    ui/                   design-system primitives (Button, Panel, Badge, Hash, SearchBar,
                          MenuRow/RowIndex, PromptInput, KeyHints, Modal, …)
    layout/               AppShell (Header + <main>), Header, Logo
    bookmarks/            BookmarksHotkeys (headless `b`/`B` owner), the name popup
                          (BookmarkEditModal) and the jump list (BookmarksListModal)
    hotkeys/              Cheatsheet — the `?` popup, rendered from lib/hotkeys.ts;
                          NetworkHotkeys — headless `M`/`T`/`D` network switch
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
   primitive `.menu-num` (via `RowIndex`, inside `MenuRow` — the one list-row
   component; `menuRowClass()` for rows that are links/buttons), `.badge` (+ `.badge-danger`/`.badge-muted`),
   `.kbd`, `.hash`, `.skeleton`, `.popover` (floating panels), `.term-caret`.

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
- **Timestamps in object JSON:** any `*timestamp_ms` field renders green with
  the UTC time (and how far from now) in its tooltip — a name heuristic in
  `JsonTree`, so it applies to every fields view without per-type code.
- **Status facets** on the owned-object views that hold their full set in
  memory (allowances, upgrade caps by policy, MVR packages by assignment, SuiNS
  names, staked SUI): a `FacetStrip` of tabs with
  counts above the rows; filtering is client-side, since status lives in Move
  contents the API can't filter on.
- **Keyboard:** `/` and `Tab` focus the search globally (see `SearchBar`); the
  hero caret is a custom overlay because native carets can't be thickened.
  `?` opens the cheatsheet (`components/hotkeys/Cheatsheet`) — it renders the
  `HOTKEYS` table in `lib/hotkeys.ts`, so **every new hotkey gets a row there**.
  The only chrome for the keyboard layer is the `?` key at the header's right
  edge; the AppShell mounts the headless owners. The whole layer is desktop-only
  (`isDesktop()`, the `sm` breakpoint): inert hotkeys and a hidden `?` below it.
  `M` / `T` / `D` switch network (`components/hotkeys/NetworkHotkeys`, the same
  `setNetwork` as the header menu). Shifted-letter keys go through
  `shiftedLetter()` so `B` and `b`+shift read the same.
  Bookmarks are vim-style marks (`components/bookmarks`): `b`
  bookmarks the current page (popup, name prefilled with the id and selected,
  ↵ saves, esc cancels), `B` opens the jump list (type to filter, ↑/↓ or
  ctrl+n/p, ↵ opens, ⌫ deletes the highlighted row while the filter is empty,
  ⌘z undoes, tab opens an action strip — open / rename / delete / copy id, with
  o/r/d/c letter keys — and esc backs out of the strip before it closes the
  popup). Bare-letter hotkeys must bail when a field is focused or a popup is
  open — keep that guard.
- **Bookmarks are per network:** stored under `devx:bookmarks:<network>`, and
  only the current network's list is ever shown, so a bookmark never carries a
  network. Identity is `search` (normalized via `detectSearchKind`) plus the
  `PIN_PARAMS` (`lib/params.ts`) — nothing else; `createdAt` is epoch ms and
  rows show it as a relative age.
- **localStorage goes through `lib/storage.ts`** (`storedString` / `storedText`
  / `storedJson`): reads are try/catch-guarded (blocked storage throws on read)
  and validated. Theme persists only an explicit choice and follows the OS
  until then.

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

## SuiNS names on addresses

Addresses render through `<AddressLink>` (`components/ui/AddressLink.tsx`),
which shows the address's *default* SuiNS name when it has one and the
truncated id otherwise — the full address stays in the tooltip / copy button.
Names always render through `atName()` in SuiNS `@` notation: `@hop`, and for
subnames `earlyblumer@suigar` / `beep.bobo@kekeke` (the `@` between the
subname labels and the registered name — also the only subname form the
`nameRecord` lookup accepts, and what `detectSearchKind` classifies as `suins`).
Two ways the name gets there (`lib/suins.ts`):

- **inline** — list queries that already return a `sender` add
  `defaultNameRecord { domain }` to it (`TX_LIST_QUERY` → `TxListItem.senderName`).
  Measured free at 50 rows, so prefer this wherever a query owns the address.
- **lazily** — anywhere else, `useSuinsName` / `AddressLink` without a `name`
  goes through `defaultSuinsNameCached`: a session memo, a localStorage cache
  (`suins-names:v1:<endpoint>`, 6h TTL, misses cached too, bounded) and
  per-tick micro-batching (one aliased `address(...)` request for every address
  asked for in the same tick, ≤ 50 each). Inline results are primed into the
  same cache (`primeSuinsNames`), so the two paths never double-fetch.

## Walrus: a self-contained module (`src/walrus/`)

Walrus (blob storage on Sui) has no name service to ask — it isn't in SuiNS and
its ids differ per network — so `src/walrus/registry.ts` *is* the resolution
table, holding only what can't be fetched: the package's *original* id (every
Walrus type is tagged with it), the System / Staking / upgrade manager /
subsidies shared objects, the testnet WAL exchanges, each with a header tag
and search keywords (`walrus-system`, `walrus-staking`, `wal` → the WAL
package, `walrus-package` → the original id, `walrus-upgrade-manager`,
`walrus-subsidies`, `wal-exchange`). The package's later versions are *not*
listed: `walrus` opens the latest by walking the on-chain upgrade chain
(`fetchPackageVersions`, memoised), and any version of the chain gets the
`walrus package` tag the same way (`useWalrusPackage`). The package's callout
links the protocol objects; the chain itself is the generic "Versions" panel
every upgraded package gets (`PackageVersions`; hidden for in-place system
packages). Retired deployments (the first testnet, wiped April 2025) are
listed too so their leftover objects are tagged as dead, never dated.

Everything Walrus-specific lives in that directory (`types.ts` predicates +
decoders, `epochs.ts` the epoch clock, `blobs.ts` the owned-blobs page query,
`components/`), and the rest of the app touches it at exactly three seams,
each marked `// walrus:` — `lib/aliases.ts` (`walrusAliases()` spread into the
alias table, so the keywords ride the generic `alias` search kind),
`ObjectView` (`WalrusTags` + `WalrusNote` in the header), and `OwnedObjects`
(the "walrus blobs" view). Add a Walrus feature inside `src/walrus`; add a seam
only when a new host surface is needed.

Two facts the module encodes that aren't obvious from the contracts:

- **Blob IDs** are the on-chain `blob_id: u256` as 32 *little-endian* bytes,
  base64url, no padding (`encodeBlobId`) — the notation the CLI, aggregators
  and explorers use. Verified against a public aggregator; big-endian 404s.
- **Walrus epochs are not Sui epochs** (2 weeks on mainnet, 1 day on testnet).
  A blob's `end_epoch` is dated by projecting from the Staking inner state's
  current epoch, its `epoch_state` timestamp (when the current epoch's change
  completed) and `epoch_duration` — `fetchWalrusState` (memoised per network,
  deliberately not tied to any caller's AbortSignal) + `walrusEpochStartMs`.
  It's an estimate (the change also needs a transaction), so every date wears
  a `~`. Components read the clock through `useWalrusState`. The owned-blobs
  view facets by status (active / uncertified / expired), so it loads blobs
  into memory — **capped at 500 with a load-all** (`useOwnedWalrusBlobs`),
  since a publisher holds tens of thousands.

## Transaction bytes: the SDK schema must track the network

`lib/transaction.ts` decodes a programmable transaction's inputs and commands
from GraphQL's `transactionBcs` with `bcs.TransactionData` from `@mysten/sui`.
That schema is a snapshot of the wire format: a protocol upgrade that adds an
enum variant (`WithdrawFrom::SenderAllowance` and the `Validity` expiration in
protocol v137, for instance) makes the parse throw on every transaction using
it. The failure is surfaced, not swallowed — `SuiTransaction.decodeError`
renders in place of the Program / Inputs panels — so that panel means one thing:
bump `@mysten/sui`. Devnet runs ahead of mainnet, so it breaks there first.

## Live feed (`search=checkpoints`)

`CheckpointsView` polls the chain tip + throughput continuously for the liveness
banner, and a switchable feed — recent checkpoints, or recent programmable
transactions (`fetchRecentTransactions`, a kind-only `PROGRAMMABLE_TX` filter on
the top-level `transactions` connection) — every 2s. Expanding a row
(`CheckpointRow` / `TransactionFeedRow`) *freezes* the feed until it's closed
or the tab is switched, so what you're inspecting holds still.

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
