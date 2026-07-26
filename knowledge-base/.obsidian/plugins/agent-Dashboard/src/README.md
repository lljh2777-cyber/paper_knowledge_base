# Agent Dashboard Source Layout

`main.js` is generated. Make implementation changes under `src/`, then run
`pnpm build` or `npm run build`.

Current module ownership:

```text
src/main.ts                  Obsidian lifecycle, views, modals, services, runtime orchestration
src/actions.ts               Dashboard action registry and action-level model defaults
src/config.ts                Stable view IDs, limits, model options, provider definitions
src/providers/profile.ts     Direct API profile defaults, normalization, capability checks
src/providers/shared.ts      Provider URL, payload, model-list, and error helpers
src/query/normalization.ts   Persisted query attachment, source, path, and citation contracts
src/services/dashboard-data.ts
                             Incremental vault scan and Dashboard metric/gap derivation
```

`src/main.ts` is temporarily marked `@ts-nocheck` because it contains the
legacy view and orchestration implementation. Extracted modules use strict
TypeScript. Remove the exemption incrementally as views and services move into
their own modules.

Build constraints:

- esbuild bundles all source modules into the CommonJS `main.js` expected by Obsidian.
- `obsidian` and `electron` stay external and are supplied by the desktop app.
- Production builds keep UTF-8 display text and do not emit a source map.
- `npm run verify` performs type checking, rebuilds `main.js`, and runs the
  dashboard regression suite.
