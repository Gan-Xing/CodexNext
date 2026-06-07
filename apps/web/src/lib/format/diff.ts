export type DiffLineKind = "file" | "hunk" | "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

const ansiPattern =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(input: string): string {
  return input.replace(ansiPattern, "");
}

export function parseUnifiedDiff(input: string): DiffLine[] {
  return input.split(/\r?\n/).map((line) => ({
    kind: classifyDiffLine(line),
    text: line
  }));
}

function classifyDiffLine(line: string): DiffLineKind {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ")
  ) {
    return "file";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "remove";
  }
  return "context";
}
