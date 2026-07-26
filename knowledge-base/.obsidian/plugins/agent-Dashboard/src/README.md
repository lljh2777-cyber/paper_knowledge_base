# Agent Dashboard Source Layout

`main.js` is generated. Make implementation changes under `src/`, then run
`pnpm build` or `npm run build`.

Current module ownership:

```text
src/main.ts                  Strict, minimal plugin entry point
src/plugin.ts                Obsidian lifecycle and runtime orchestration
src/actions.ts               Dashboard action registry and action-level model defaults
src/config.ts                Stable view IDs, limits, model options, provider definitions
src/modals/                  Action input, task result, practice-note, and image-picker dialogs
src/providers/adapters.ts    Direct API and Codex CLI provider implementations
src/providers/profile.ts     Direct API profile defaults, normalization, capability checks
src/providers/shared.ts      Provider URL, payload, model-list, and error helpers
src/query/normalization.ts   Persisted query attachment, source, path, and citation contracts
src/runtime/settings.ts      Executable discovery and persisted setting defaults
src/services/dashboard-data.ts
                             Incremental vault scan and Dashboard metric/gap derivation
src/settings/settings-tab.ts Obsidian settings UI
src/views/                   Code practice, conversational query, and Dashboard ItemViews
```

The entry point and extracted contract/helper modules use strict TypeScript.
Large UI and runtime-orchestration modules temporarily retain `@ts-nocheck`;
remove those exemptions incrementally as their host interfaces and persisted
data types are formalized.

Build constraints:

- esbuild bundles all source modules into the CommonJS `main.js` expected by Obsidian.
- `obsidian` and `electron` stay external and are supplied by the desktop app.
- Production builds keep UTF-8 display text and do not emit a source map.
- `npm run verify` performs type checking, rebuilds `main.js`, and runs the
  dashboard regression suite.
