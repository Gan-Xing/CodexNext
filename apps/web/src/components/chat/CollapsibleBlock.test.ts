import { describe, expect, it } from "vitest";
import {
  collapseLineToggleText,
  hiddenLineCount,
  shouldCollapseByLineCount
} from "./CollapsibleBlock";

describe("CollapsibleBlock helpers", () => {
  it("collapses only when line count exceeds the threshold", () => {
    expect(shouldCollapseByLineCount(120, 120)).toBe(false);
    expect(shouldCollapseByLineCount(121, 120)).toBe(true);
  });

  it("formats hidden line labels", () => {
    expect(hiddenLineCount(350, 300)).toBe(50);
    expect(
      collapseLineToggleText({
        expanded: false,
        hiddenLines: 50,
        noun: "输出"
      })
    ).toBe("展开剩余 50 行");
    expect(
      collapseLineToggleText({
        expanded: true,
        hiddenLines: 50,
        noun: "输出"
      })
    ).toBe("收起输出");
  });
});
