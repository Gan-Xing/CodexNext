import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff";

describe("parseUnifiedDiff", () => {
  it("classifies diff lines", () => {
    const lines = parseUnifiedDiff([
      "diff --git a/file b/file",
      "--- a/file",
      "+++ b/file",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      " unchanged"
    ].join("\n"));

    expect(lines.map((line) => line.kind)).toEqual([
      "file",
      "file",
      "file",
      "hunk",
      "remove",
      "add",
      "context"
    ]);
  });
});
