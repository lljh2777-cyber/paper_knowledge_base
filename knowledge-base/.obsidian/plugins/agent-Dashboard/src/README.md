# Agent Dashboard Source Layout

`main.js` is generated. Make implementation changes under `src/`, then run
`pnpm build` or `npm run build`.

Current module ownership:

```text
src/main.ts                  Strict, minimal plugin entry point
src/plugin.ts                Strict composition root and vault/query orchestration
src/actions.ts               Dashboard action registry and action-level model defaults
src/config.ts                Stable view IDs, limits, model options, provider definitions
src/modals/                  Action input, task result, practice-note, and image-picker dialogs
src/providers/adapters.ts    Direct API and Codex CLI provider implementations
src/providers/profile.ts     Direct API profile defaults, normalization, capability checks
src/providers/shared.ts      Provider URL, payload, model-list, and error helpers
src/query/normalization.ts   Persisted query attachment, source, path, and citation contracts
src/runtime/settings.ts      Executable discovery and persisted setting defaults
src/runtime/lifecycle-state.ts
                             Active process, provider, and query-run state
src/runtime/process-execution.ts
                             Typed Python/Codex child-process execution and cleanup
src/runtime/persistence.ts   Version-tolerant state decoding and serialized saves
src/services/dashboard-data.ts
                             Incremental vault scan and Dashboard metric/gap derivation
src/settings/settings-tab.ts Obsidian settings UI
src/types/contracts.ts       Shared PluginHost, task, query-session, and provider contracts
src/views/                   Code practice, conversational query, and Dashboard ItemViews
```

All source modules, including `src/plugin.ts`, use strict TypeScript. The plugin
class is the Obsidian composition root; runtime process handles and save queues
are owned by focused services.

Build constraints:

- esbuild bundles all source modules into the CommonJS `main.js` expected by Obsidian.
- `obsidian` and `electron` stay external and are supplied by the desktop app.
- Production builds keep UTF-8 display text and do not emit a source map.
- `npm run verify` performs type checking, rebuilds `main.js`, and runs the
  dashboard regression suite.
