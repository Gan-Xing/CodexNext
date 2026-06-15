import { useMemo } from "react";
import { parseUnifiedDiff } from "../../lib/format/diff";
import {
  CollapsibleBlock,
  collapseLineToggleText,
  hiddenLineCount,
  shouldCollapseByLineCount
} from "./CollapsibleBlock";
import { CopyButton } from "./CopyButton";

const COLLAPSE_LINES = 220;

export function DiffBlock(props: {
  diff: string;
}) {
  const lines = useMemo(() => parseUnifiedDiff(props.diff), [props.diff]);
  const hiddenLines = hiddenLineCount(lines.length, COLLAPSE_LINES);
  const shouldCollapse = shouldCollapseByLineCount(lines.length, COLLAPSE_LINES);

  return (
    <CollapsibleBlock
      className="cn-semantic-block cn-diff-block"
      shouldCollapse={shouldCollapse}
      collapsedLabel={collapseLineToggleText({
        expanded: false,
        hiddenLines,
        noun: "diff"
      })}
      expandedLabel={collapseLineToggleText({
        expanded: true,
        hiddenLines,
        noun: "diff"
      })}
      header={
        <header className="cn-semantic-header">
          <strong>Diff updated</strong>
          <CopyButton label="复制 diff" value={props.diff} />
        </header>
      }
    >
      {({ expanded }) => {
        const visible = shouldCollapse && !expanded ? lines.slice(0, COLLAPSE_LINES) : lines;
        return (
          <div className="cn-diff-lines">
            {visible.map((line, index) => (
              <div key={`${index}-${line.text}`} className={`cn-diff-line ${line.kind}`}>
                {line.text || " "}
              </div>
            ))}
          </div>
        );
      }}
    </CollapsibleBlock>
  );
}
