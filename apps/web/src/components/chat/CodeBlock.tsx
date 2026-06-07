import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

export function CodeBlock(props: {
  code: string;
  children?: ReactNode;
  className?: string;
  language?: string;
}) {
  return (
    <div className="cn-code-block">
      <div className="cn-code-block-header">
        <span>{props.language || "text"}</span>
        <CopyButton value={props.code} />
      </div>
      <pre className="cn-code-pre">
        <code className={props.className}>{props.children ?? props.code}</code>
      </pre>
    </div>
  );
}
