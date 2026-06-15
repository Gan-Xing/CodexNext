"use client";

import { type CSSProperties, type ReactNode, useState } from "react";

const DEFAULT_COLLAPSED_HEIGHT = 360;

export function shouldCollapseByLineCount(lineCount: number, maxLines: number): boolean {
  return Number.isFinite(lineCount) && lineCount > maxLines;
}

export function hiddenLineCount(lineCount: number, maxLines: number): number {
  return Math.max(0, lineCount - maxLines);
}

export function collapseLineToggleText(input: {
  expanded: boolean;
  hiddenLines: number;
  noun: string;
}): string {
  return input.expanded ? `收起${input.noun}` : `展开剩余 ${input.hiddenLines} 行`;
}

export function CollapsibleBlock(props: {
  bodyStyle?: CSSProperties;
  children:
    | ReactNode
    | ((state: { collapsed: boolean; expanded: boolean }) => ReactNode);
  className?: string;
  collapsedHeight?: number;
  collapsedLabel: string;
  expandedLabel: string;
  header?: ReactNode;
  shouldCollapse: boolean;
  toggleStyle?: CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = props.shouldCollapse && !expanded;
  const bodyStyle = collapsed
    ? {
        ...props.bodyStyle,
        maxHeight: props.collapsedHeight ?? DEFAULT_COLLAPSED_HEIGHT,
        overflow: "hidden"
      }
    : props.bodyStyle;
  const children =
    typeof props.children === "function"
      ? props.children({ collapsed, expanded })
      : props.children;

  return (
    <div className={props.className}>
      {props.header}
      <div style={bodyStyle}>{children}</div>
      {props.shouldCollapse ? (
        <button
          className="cn-semantic-toggle"
          type="button"
          aria-expanded={expanded}
          style={props.toggleStyle}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? props.expandedLabel : props.collapsedLabel}
        </button>
      ) : null}
    </div>
  );
}
