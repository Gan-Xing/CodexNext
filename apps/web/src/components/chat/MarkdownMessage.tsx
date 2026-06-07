import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";

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
