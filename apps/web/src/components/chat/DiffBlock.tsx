import { useMemo, useState } from "react";
import { parseUnifiedDiff } from "../../lib/format/diff";
import { CopyButton } from "./CopyButton";

const COLLAPSE_LINES = 220;

export function DiffBlock(props: {
  diff: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => parseUnifiedDiff(props.diff), [props.diff]);
  const collapsed = lines.length > COLLAPSE_LINES && !expanded;
  const visible = collapsed ? lines.slice(0, COLLAPSE_LINES) : lines;

  return (
    <section className="cn-semantic-block cn-diff-block">
      <header className="cn-semantic-header">
        <strong>Diff updated</strong>
        <CopyButton label="复制 diff" value={props.diff} />
      </header>
      <div className="cn-diff-lines">
        {visible.map((line, index) => (
          <div key={`${index}-${line.text}`} className={`cn-diff-line ${line.kind}`}>
            {line.text || " "}
          </div>
        ))}
      </div>
      {lines.length > COLLAPSE_LINES ? (
        <button
          className="cn-semantic-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起 diff" : `展开剩余 ${lines.length - COLLAPSE_LINES} 行`}
        </button>
      ) : null}
    </section>
  );
}
