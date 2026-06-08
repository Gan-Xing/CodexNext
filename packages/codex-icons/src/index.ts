import { codexAssetSvgByName, type CodexAssetName } from "./generated.ts";

export type CodexUiIconName =
  | "arrowUp"
  | "archive"
  | "back"
  | "browserUse"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "clock"
  | "collapse"
  | "compose"
  | "document"
  | "edit"
  | "forward"
  | "folder"
  | "folderPlus"
  | "goal"
  | "github"
  | "gmail"
  | "googleDrive"
  | "hand"
  | "imageSquare"
  | "phone"
  | "pin"
  | "more"
  | "notion"
  | "plug"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "shieldAlert"
  | "stop"
  | "summary"
  | "tasks"
  | "terminal"
  | "trash"
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
  goal:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.96861 1.91681C10.3002 1.91681 10.569 2.18564 10.569 2.51722C10.5688 2.84865 10.3001 3.11764 9.96861 3.11764C6.14529 3.11779 3.04595 6.21713 3.04579 10.0404C3.04597 13.8637 6.14531 16.964 9.96861 16.9641C13.792 16.9641 16.8921 13.8638 16.8923 10.0404C16.8925 9.709 17.1612 9.44003 17.4927 9.44003C17.8241 9.44019 18.093 9.7091 18.0931 10.0404C18.0929 14.527 14.4552 18.165 9.96861 18.165C5.48215 18.1648 1.84515 14.5269 1.84497 10.0404C1.84513 5.55398 5.48214 1.91697 9.96861 1.91681Z" fill="currentColor"></path><path d="M8.73428 5.4417C9.05275 5.34987 9.38553 5.53321 9.47752 5.85167C9.56932 6.17 9.38575 6.50275 9.06755 6.59491C7.60672 7.01688 6.53899 8.36477 6.53894 9.96021C6.53907 11.8943 8.10685 13.4629 10.0409 13.4631C11.6106 13.463 12.9407 12.429 13.385 11.0041C13.4838 10.6877 13.8206 10.5114 14.1371 10.61C14.4536 10.7087 14.6308 11.0455 14.5321 11.3621C13.9357 13.2742 12.1509 14.663 10.0409 14.663C7.44369 14.6628 5.33824 12.5574 5.33812 9.96021C5.33816 7.81571 6.77345 6.00809 8.73428 5.4417Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M13.8656 1.99087C14.3948 1.60393 15.1805 1.97721 15.1739 2.67063L15.1528 4.83776L17.319 4.8166L17.4539 4.82541C18.1023 4.92002 18.4014 5.73603 17.9115 6.22638L15.5046 8.63331C15.3075 8.83039 15.04 8.94171 14.7613 8.94189H12.2063L10.3936 10.7555C10.1591 10.9899 9.77811 10.9899 9.54364 10.7555C9.30989 10.521 9.30952 10.1407 9.54364 9.90643L11.0486 8.40144V5.22922C11.0486 4.95027 11.1591 4.68234 11.3563 4.48509L13.7633 2.07816L13.8656 1.99087ZM12.2495 5.29005V7.74107H14.6978L16.4136 6.02536L13.9414 6.05004L13.9643 3.57434L12.2495 5.29005Z" fill="currentColor"></path></svg>',
  hand:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.2 9.7V5.6a1.1 1.1 0 0 1 2.2 0v3.2M9.4 8.7V4.8a1.1 1.1 0 0 1 2.2 0v4M11.6 9V6a1.1 1.1 0 0 1 2.2 0v5.2c0 3.1-1.7 5.2-4.7 5.2H8c-1.4 0-2.4-.5-3.2-1.5L2.9 12a1.1 1.1 0 0 1 1.8-1.3l1.1 1.4V8.4a1.1 1.1 0 0 1 2.2 0v1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  shield:
    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123Z" fill="none" stroke="currentColor" stroke-width="1.45"></path><path d="M10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0018 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z" fill="currentColor"></path></svg>'
} as const;

const codexUiIconSpecs = {
  arrowUp: { asset: "arrow-up-coa6jjxn" },
  archive: { asset: "archive-d1deq-zz" },
  back: { asset: "arrow-left-cy8p3y0c" },
  browserUse: { asset: "browser-use-b5flzyg6" },
  check: { asset: "check-md-bzlzxdm7" },
  chevronDown: { asset: "chevron-aeenlp4g" },
  chevronLeft: { asset: "chevron-right-cqaqxhbx", rotateDegrees: 180 },
  chevronRight: { asset: "chevron-right-cqaqxhbx" },
  clock: { asset: "clock-bjqums8u" },
  collapse: { svg: inlineSvgByName.collapse },
  compose: { asset: "compose-bhtlanqm" },
  document: { asset: "document-search-c-kua6rp" },
  edit: { asset: "edit-b9jltkkg" },
  folder: { asset: "folder-bpwd3kcz" },
  folderPlus: { asset: "add-project-menu-items-cy9ai-pb" },
  forward: { asset: "arrow-left-cy8p3y0c", rotateDegrees: 180 },
  goal: { svg: inlineSvgByName.goal },
  github: { asset: "github-mark-dzuhu9c1" },
  gmail: { asset: "known-app-icon-bei7oxdu--09" },
  googleDrive: { asset: "google-drive-cc-egn92" },
  hand: { svg: inlineSvgByName.hand },
  imageSquare: { asset: "image-square-cpvm9cik" },
  more: { asset: "three-dots-c-3fbqw8" },
  notion: { asset: "notion-cpbap5le--02" },
  phone: { asset: "phone-dfkyobyn" },
  pin: { asset: "local-conversation-background-terminals-model-cpnrd5q0" },
  plug: { asset: "apps-dbd5dyzg" },
  plus: { asset: "plus-d3dp-dmx" },
  search: { asset: "search-c0nm-ej1" },
  settings: { asset: "settings-cog-mjpuk5w" },
  shield: { svg: inlineSvgByName.shield },
  shieldAlert: { asset: "shield-exclamation-kf9myntx" },
  stop: { asset: "stop-d3wuyj06" },
  summary: { asset: "thread-side-panel-tabs-qmoazjz--04" },
  tasks: { asset: "tasks-bdbup9t4" },
  terminal: { asset: "terminal-bhtf7d-4" },
  trash: { asset: "trash-clrlrkdw" },
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
