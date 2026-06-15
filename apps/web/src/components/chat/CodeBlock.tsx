import type { ReactNode } from "react";
import {
  CollapsibleBlock,
  collapseLineToggleText,
  hiddenLineCount,
  shouldCollapseByLineCount
} from "./CollapsibleBlock";
import { CopyButton } from "./CopyButton";

const COLLAPSE_LINES = 120;

export function CodeBlock(props: {
  code: string;
  children?: ReactNode;
  className?: string;
  language?: string;
}) {
  const lineCount = props.code.split(/\r?\n/).length;
  const hiddenLines = hiddenLineCount(lineCount, COLLAPSE_LINES);
  const shouldCollapse = shouldCollapseByLineCount(lineCount, COLLAPSE_LINES);

  return (
    <CollapsibleBlock
      className="cn-code-block"
      shouldCollapse={shouldCollapse}
      collapsedLabel={collapseLineToggleText({
        expanded: false,
        hiddenLines,
        noun: "代码"
      })}
      expandedLabel={collapseLineToggleText({
        expanded: true,
        hiddenLines,
        noun: "代码"
      })}
      toggleStyle={{ margin: "0 0.75rem 0.75rem" }}
      header={
        <div className="cn-code-block-header">
          <span>{props.language || "text"}</span>
          <CopyButton value={props.code} />
        </div>
      }
    >
      <pre className="cn-code-pre">
        <code className={props.className}>{props.children ?? props.code}</code>
      </pre>
    </CollapsibleBlock>
  );
}
