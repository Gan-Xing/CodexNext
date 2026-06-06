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

Implemented in `apps/web/src/components/DesignLab.tsx` as `CodexIcon` for the current design prototype:

- `folder`
- `compose`
- `search`
- `arrowUp`
- `settings`
- `shield`
- `shieldAlert`
- `terminal`
- `collapse`
- `back`
- `forward`
- `chevronDown`
- `chevronRight`
- `check`
- `plus`
- `more`
- `phone`
- `edit`
- `x`

The live component gallery is available at `/design/components`. New icons should be added there first so spacing, stroke/fill weight, names, and hover usage stay consistent before they are used in production UI.

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

Not every Codex icon is exposed as a plain standalone SVG asset, so CodexNext should expand this registry incrementally as each UI surface needs icons.
