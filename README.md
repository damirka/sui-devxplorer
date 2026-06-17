# sui-devxplorer

A developer-first **Sui network explorer**. Pure single-page app, **no backend** —
all data comes from the [Sui GraphQL API](https://graphql.mainnet.sui.io/graphql).
Search-first: paste any address, object id, transaction digest, or package and
get a deep-linkable view. Planned standouts: rich transaction / inputs / arguments
rendering, and package decompilation with source links.

> **Status:** UI foundation only. Result views are styled placeholders; GraphQL
> data is not wired yet.

## Stack

- **Vite + React + TypeScript**, package manager **pnpm**
- **Tailwind v4** (CSS-first `@theme`; tokens + custom component classes in
  `src/styles/index.css`)
- **react-router-dom** — shareable URL state
- Planned: `@mysten/dapp-kit`, `@mysten/sui`, a GraphQL client

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # tsc -b && vite build  → dist/
pnpm preview
```

## Design language

**Matrix phosphor green + Sifu brutalist structure** — functional and dry.
Mono-forward, sharp edges everywhere (no rounded corners), dense. One signal
hue — phosphor green `#00ff41` on near-black `#020604` — marks *signal* (focus,
type, links, active network); one alarm hue — red `#ff3b3b` — is reserved for
failures and errors, never decoration. Sections read as terminal/Sifu menu
lines (`01  LABEL ─────────`) and lists are indexed (`01`, `02`, …). The landing
page is a single centered prompt (`❯`) that is the search input. Dark default;
light = inverted tokens.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how it's wired.
