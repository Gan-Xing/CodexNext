import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import {
  CollapsibleBlock,
  collapseLineToggleText,
  hiddenLineCount,
  shouldCollapseByLineCount
} from "./CollapsibleBlock";

const TABLE_COLLAPSE_ROWS = 18;

export function MarkdownMessage(props: {
  className?: string;
  text: string;
}) {
  return (
    <div className={props.className ?? "cn-markdown-message"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ children, href }: any) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ children, className }: any) => (
            <code className={className ? `cn-inline-code ${className}` : "cn-inline-code"}>
              {children}
            </code>
          ),
          pre: ({ children }: any) => {
            const child = Children.toArray(children)[0];
            if (!isValidElement(child)) {
              const code = String(children ?? "").replace(/\n$/, "");
              return <CodeBlock code={code} language="text" />;
            }
            const childProps = child.props as { children?: ReactNode; className?: string };
            const className = childProps.className ?? "";
            const language = className.replace(/^language-/, "") || "text";
            const code = extractTextContent(childProps.children).replace(/\n$/, "");
            return (
              <CodeBlock code={code} language={language} className={className}>
                {childProps.children}
              </CodeBlock>
            );
          },
          table: ({ children, node: _node, ...tableProps }: any) => {
            const rowCount = countElementType(children, "tr");
            const hiddenRows = hiddenLineCount(rowCount, TABLE_COLLAPSE_ROWS);
            return (
              <CollapsibleBlock
                shouldCollapse={shouldCollapseByLineCount(rowCount, TABLE_COLLAPSE_ROWS)}
                collapsedLabel={collapseLineToggleText({
                  expanded: false,
                  hiddenLines: hiddenRows,
                  noun: "表格"
                })}
                expandedLabel={collapseLineToggleText({
                  expanded: true,
                  hiddenLines: hiddenRows,
                  noun: "表格"
                })}
              >
                <table {...tableProps}>{children}</table>
              </CollapsibleBlock>
            );
          },
          hr: () => <hr className="cn-markdown-rule" />
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function extractTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => extractTextContent(child)).join("");
  }
  if (isValidElement(node)) {
    return extractTextContent((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function countElementType(node: ReactNode, type: string): number {
  if (Array.isArray(node)) {
    return node.reduce((count, child) => count + countElementType(child, type), 0);
  }
  if (!isValidElement(node)) {
    return 0;
  }
  const ownCount = node.type === type ? 1 : 0;
  return ownCount + countElementType((node.props as { children?: ReactNode }).children, type);
}
