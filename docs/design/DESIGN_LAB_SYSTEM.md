# CodexNext Design Lab System

`/design` is the long-running UI workbench for CodexNext. It is intentionally fake-data first: every new interaction should be designed and reviewed here before it is wired to the real local agent.

## Why This Exists

CodexNext needs a UI that can keep evolving across phases without turning into a pile of screenshots. The Design Lab gives us a stable place to:

- explore the Codex-style desktop Web console visually;
- test interactions with real React and CSS;
- keep fake data separate from agent/server logic;
- promote approved UI into the real console when the interaction is settled.

## Route Structure

- `/design`: current canonical design board.
- `/design/new-session`: new conversation, project selection, permission, model, reasoning, and first send.
- `/design/thread`: active conversation, running turn, steer, and interrupt.
- `/design/approval`: approval request handling.
- `/design/device`: device selection, naming, and project folder selection.
- `/design/settings`: future account/device/preference surfaces.
- `/design/components`: Codex-style shared components and icon registry.
- `/design/archive`: retired explorations and older screenshots.

## Iteration Rule

Do not continue by adding "10-19" or "20-29" screens to one giant board.

For a new phase:

1. Add or extend a named flow in `apps/web/src/components/DesignLab.tsx`.
2. Add a stable route under `apps/web/src/app/design/` when the flow deserves a direct URL.
3. Use fake data until the interaction is approved.
4. Move replaced screenshots or older experiments into `/design/archive` and `docs/design/`.
5. Only then wire the real agent, events, approval requests, or file system behavior.

## Promotion Rule

The Design Lab is not production logic. A UI pattern is ready to promote only when:

- the empty state, active state, error/blocked state, and long-text behavior are visible;
- icons come from the Codex-style registry;
- text is in the product language we actually want users to see;
- the interaction has an obvious path back to the real app-server capability.

## Current Source Files

- `apps/web/src/components/DesignLab.tsx`
- `apps/web/src/app/globals.css`
- `docs/design/CODEX_ICON_SYSTEM.md`

