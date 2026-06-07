# Codex Icons

This package is the single source of truth for CodexNext UI icons.

It vendors SVG icon assets extracted from a locally installed `Codex.app`, and it
also exposes the semantic icon registry that app code should consume.

## What is here

- `svg/`: extracted SVG files
- `manifest.json`: source-to-output mapping plus basic metadata
- `scripts/extract-codex-icons.mjs`: repeatable extractor
- `src/generated.ts`: generated asset registry keyed by stable file slug
- `src/index.ts`: semantic icon API used by app code

If you only want the cleanest one-to-one icon modules, start with manifest entries
where `totalInModule === 1`. Entries with a higher `totalInModule` came from larger
Codex bundles that embed multiple SVG assets in one source module.

## App Usage

Application code should use the semantic registry, not raw file names:

```ts
import { getCodexUiIcon, type CodexUiIconName } from "@codexnext/codex-icons";
```

Rules:

- Do not inline SVGs in `apps/web` components.
- Do not import files from `svg/` directly in UI code.
- Add or adjust semantic mappings only in `packages/codex-icons/src/index.ts`.
- Re-run `pnpm sync:codex-icons` whenever you want to refresh vendored Codex assets.

## Sync

From the repo root:

```bash
pnpm sync:codex-icons
```

By default the extractor reads:

```text
/Applications/Codex.app/Contents/Resources/app.asar
```

You can override the source with either an extracted assets directory or another
`app.asar` path:

```bash
node packages/codex-icons/scripts/extract-codex-icons.mjs --source /path/to/app.asar
node packages/codex-icons/scripts/extract-codex-icons.mjs --source /path/to/extracted/app
```

## Notes

- Assets are extracted from the locally installed Codex application bundle, not hand-copied.
- The extractor keeps a manifest so later icon lookups can be traced back to the upstream asset module.
- The semantic API may intentionally map multiple UI names onto one underlying asset plus rotation.
- If a needed icon does not exist as a clean standalone Codex asset, keep the fallback SVG here in this package instead of recreating it in app code.
- Review distribution/licensing implications before publishing these assets outside your internal repo.
