import { codexAssetSvgByName, type CodexAssetName } from "./generated.ts";

export type CodexUiIconName =
  | "arrowUp"
  | "archive"
  | "back"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "clock"
  | "collapse"
  | "compose"
  | "edit"
  | "forward"
  | "folder"
  | "hand"
  | "phone"
  | "pin"
  | "more"
  | "plug"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "shieldAlert"
  | "terminal"
  | "x";

type AssetIconSpec = {
  asset: CodexAssetName;
  rotateDegrees?: number;
};

type InlineIconSpec = {
  svg: string;
  rotateDegrees?: number;
};

type CodexUiIconSpec = AssetIconSpec | InlineIconSpec;

const inlineSvgByName = {
  collapse:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="14" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></rect><path d="M8 3v14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  hand:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.2 9.7V5.6a1.1 1.1 0 0 1 2.2 0v3.2M9.4 8.7V4.8a1.1 1.1 0 0 1 2.2 0v4M11.6 9V6a1.1 1.1 0 0 1 2.2 0v5.2c0 3.1-1.7 5.2-4.7 5.2H8c-1.4 0-2.4-.5-3.2-1.5L2.9 12a1.1 1.1 0 0 1 1.8-1.3l1.1 1.4V8.4a1.1 1.1 0 0 1 2.2 0v1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  shield:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123Z" fill="none" stroke="currentColor" stroke-width="1.45"></path><path d="M10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0018 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z" fill="currentColor"></path></svg>'
} as const;

const codexUiIconSpecs = {
  arrowUp: { asset: "arrow-up-coa6jjxn" },
  archive: { asset: "archive-d1deq-zz" },
  back: { asset: "arrow-left-cy8p3y0c" },
  check: { asset: "check-md-bzlzxdm7" },
  chevronDown: { asset: "chevron-aeenlp4g" },
  chevronLeft: { asset: "chevron-right-cqaqxhbx", rotateDegrees: 180 },
  chevronRight: { asset: "chevron-right-cqaqxhbx" },
  clock: { asset: "clock-bjqums8u" },
  collapse: { svg: inlineSvgByName.collapse },
  compose: { asset: "compose-bhtlanqm" },
  edit: { asset: "edit-b9jltkkg" },
  folder: { asset: "folder-bpwd3kcz" },
  forward: { asset: "arrow-left-cy8p3y0c", rotateDegrees: 180 },
  hand: { svg: inlineSvgByName.hand },
  more: { asset: "three-dots-c-3fbqw8" },
  phone: { asset: "phone-dfkyobyn" },
  pin: { asset: "local-conversation-background-terminals-model-cpnrd5q0" },
  plug: { asset: "apps-dbd5dyzg" },
  plus: { asset: "plus-d3dp-dmx" },
  search: { asset: "search-c0nm-ej1" },
  settings: { asset: "settings-cog-mjpuk5w" },
  shield: { svg: inlineSvgByName.shield },
  shieldAlert: { asset: "shield-exclamation-kf9myntx" },
  terminal: { asset: "terminal-bhtf7d-4" },
  x: { asset: "x-dypucsqe" }
} satisfies Record<CodexUiIconName, CodexUiIconSpec>;

export function getCodexAssetSvg(name: CodexAssetName): string {
  return codexAssetSvgByName[name];
}

export function getCodexUiIcon(name: CodexUiIconName): { rotateDegrees?: number; svg: string } {
  const spec = codexUiIconSpecs[name];
  const rotateDegrees = "rotateDegrees" in spec ? spec.rotateDegrees : undefined;
  const svg = "asset" in spec ? getCodexAssetSvg(spec.asset) : spec.svg;

  if (rotateDegrees == null) {
    return { svg };
  }

  return {
    rotateDegrees,
    svg
  };
}

export const codexUiIconNames = Object.freeze(
  Object.keys(codexUiIconSpecs) as CodexUiIconName[]
);
