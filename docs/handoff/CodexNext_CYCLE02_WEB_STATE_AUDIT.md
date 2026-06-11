# CodexNext Cycle 02 Web State Audit

Cycle 02 extracted the highest-risk controller-adjacent decisions that could be tested without rendering the full console:

- relay permission option filtering now lives in `apps/web/src/features/console/console-utils.ts`
- relay session expiry classification now lives in `apps/web/src/features/console/console-utils.ts`
- console preference writes now live in `apps/web/src/features/console/console-storage.ts`
- stale Socket.IO stream activity after `close()` is ignored in `apps/web/src/lib/event-stream.ts`
- relay API URL/header construction for mobile-shared paths now comes from `@codexnext/relay-client`

Remaining controller extraction plan:

1. Move relay device hydration and presence polling into a tested `useRelayDevices` hook or pure state reducer.
2. Move history preview hydration/cache behavior into a dedicated module with cache TTL tests.
3. Move goal/sidebar sync into a small relay-prefs adapter so remote sync failures can be classified separately from session expiry.
4. Keep `useWebConsoleController` as the composition layer for UI state, but avoid adding new localStorage, URL mapping, or Socket.IO sequencing logic directly in it.

Open risk:

- The controller still owns many async workflows. New feature work should first ask whether the behavior belongs in `console-utils`, `console-storage`, `event-stream`, `session-utils`, `device-utils`, or `@codexnext/relay-client`.
