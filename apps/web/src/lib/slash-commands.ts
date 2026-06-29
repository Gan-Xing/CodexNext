export const FAST_SERVICE_TIER = "priority";

export type SlashCommandId = "fast";

export interface SlashCommand {
  description: string;
  id: SlashCommandId;
  label: string;
  name: string;
}

export interface SlashCommandContext {
  query: string;
  tokenEnd: number;
  tokenStart: number;
}

export const slashCommands: SlashCommand[] = [
  {
    description: "开启 Fast service tier",
    id: "fast",
    label: "快速模式",
    name: "fast"
  }
];

export function resolveSlashCommandContext(
  input: string,
  selectionStart = input.length
): SlashCommandContext | null {
  if (!input.startsWith("/") || selectionStart < 1) {
    return null;
  }

  const firstLineEnd = firstLineBreakIndex(input);
  if (selectionStart > firstLineEnd) {
    return null;
  }

  const tokenEnd = commandTokenEnd(input, firstLineEnd);
  if (selectionStart > tokenEnd) {
    return null;
  }

  return {
    query: input.slice(1, tokenEnd).toLowerCase(),
    tokenEnd,
    tokenStart: 0
  };
}

export function filterSlashCommands(
  query: string,
  commands: readonly SlashCommand[] = slashCommands
): SlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...commands];
  }
  return commands.filter((command) => command.name.startsWith(normalizedQuery));
}

export function resolveSubmittedSlashCommand(input: string): SlashCommand | null {
  const normalizedInput = input.replace(/\r\n/g, "\n").trimEnd();
  if (normalizedInput.includes("\n")) {
    return null;
  }
  return slashCommands.find((command) => normalizedInput === `/${command.name}`) ?? null;
}

function firstLineBreakIndex(input: string): number {
  const newlineIndex = input.search(/\r?\n/);
  return newlineIndex === -1 ? input.length : newlineIndex;
}

function commandTokenEnd(input: string, firstLineEnd: number): number {
  for (let index = 1; index < firstLineEnd; index += 1) {
    if (/\s/.test(input[index]!)) {
      return index;
    }
  }
  return firstLineEnd;
}
