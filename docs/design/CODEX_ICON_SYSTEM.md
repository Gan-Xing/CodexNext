# CodexNext Codex-Style Icon System

This note records the icon rule for the `/design` prototype and future Web Console UI.

## Rule

CodexNext UI icons should use one Codex-style icon registry instead of emoji, CSS-drawn icons, or mixed third-party icon packs.

Visible icons should follow the Codex desktop visual language:

- 20px viewport by default
- `currentColor`
- rounded line geometry when stroked
- filled path geometry where Codex desktop uses filled path icons
- muted gray in sidebars and menus
- black/white only for primary action buttons

The sidebar collapse icon controls the whole conversation sidebar layout. Project groups use chevron icons for per-project expand/collapse.

## Current Registry

The canonical icon source now lives in `packages/codex-icons`:

- `packages/codex-icons/src/index.ts`: semantic icon registry for app code
- `packages/codex-icons/src/generated.ts`: generated asset map
- `packages/codex-icons/svg/`: vendored SVG source files
- `packages/codex-icons/manifest.json`: source tracing metadata

`apps/web/src/components/DesignLab.tsx` still exports `CodexIcon`, but it is now only a thin renderer over `@codexnext/codex-icons`. It must not contain icon path definitions anymore.

The live component gallery remains available at `/design/components`.

## Source Notes

The local Codex desktop app exposes bundled web assets inside:

`/Applications/Codex.app/Contents/Resources/app.asar`

Relevant bundled module names observed during design work include:

- `folder-BPWd3kCZ.js`
- `folders-DYfgzYQz.js`
- `compose-BhtlAnQm.js`
- `search-C0nm-Ej1.js`
- `settings.cog-_MjPuK5w.js`
- `arrow-up-COA6jJxN.js`
- `shield-code-BQug9YbU.js`
- `shield-exclamation-kf9mYNtx.js`
- `terminal-BhTF7d-4.js`

Not every Codex icon is exposed as a plain standalone SVG asset, so CodexNext should expand the semantic registry incrementally as each UI surface needs icons.

## Working Rule

From this point on:

- App code must use semantic names from `@codexnext/codex-icons`.
- App code must not inline raw SVG markup.
- App code must not import from `packages/codex-icons/svg` directly.
- Missing icons should be added in `packages/codex-icons/src/index.ts`.
- Upstream Codex asset refreshes should run through `pnpm sync:codex-icons`.
