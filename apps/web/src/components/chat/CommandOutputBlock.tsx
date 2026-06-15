import { useMemo } from "react";
import {
  CollapsibleBlock,
  collapseLineToggleText,
  hiddenLineCount,
  shouldCollapseByLineCount
} from "./CollapsibleBlock";
import { CopyButton } from "./CopyButton";

const COLLAPSE_LINES = 300;

export function CommandOutputBlock(props: {
  text: string;
}) {
  const lines = useMemo(() => props.text.split(/\r?\n/), [props.text]);
  const hiddenLines = hiddenLineCount(lines.length, COLLAPSE_LINES);
  const shouldCollapse = shouldCollapseByLineCount(lines.length, COLLAPSE_LINES);

  return (
    <CollapsibleBlock
      className="cn-semantic-block cn-command-block"
      shouldCollapse={shouldCollapse}
      collapsedLabel={collapseLineToggleText({
        expanded: false,
        hiddenLines,
        noun: "输出"
      })}
      expandedLabel={collapseLineToggleText({
        expanded: true,
        hiddenLines,
        noun: "输出"
      })}
      header={
        <header className="cn-semantic-header">
          <strong>Command output</strong>
          <CopyButton value={props.text} />
        </header>
      }
    >
      {({ expanded }) => {
        const visible = shouldCollapse && !expanded ? lines.slice(0, COLLAPSE_LINES) : lines;
        return (
          <pre className="cn-command-pre">
            <code>{visible.join("\n")}</code>
          </pre>
        );
      }}
    </CollapsibleBlock>
  );
}
