import { useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";

const COLLAPSE_LINES = 300;

export function CommandOutputBlock(props: {
  text: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => props.text.split(/\r?\n/), [props.text]);
  const collapsed = lines.length > COLLAPSE_LINES && !expanded;
  const visible = collapsed ? lines.slice(0, COLLAPSE_LINES) : lines;

  return (
    <section className="cn-semantic-block cn-command-block">
      <header className="cn-semantic-header">
        <strong>Command output</strong>
        <CopyButton value={props.text} />
      </header>
      <pre className="cn-command-pre">
        <code>{visible.join("\n")}</code>
      </pre>
      {lines.length > COLLAPSE_LINES ? (
        <button
          className="cn-semantic-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起输出" : `展开剩余 ${lines.length - COLLAPSE_LINES} 行`}
        </button>
      ) : null}
    </section>
  );
}
