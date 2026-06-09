export function ThinkingRow(props: {
  text: string;
  tone?: "thinking" | "error";
}) {
  const tone = props.tone ?? "thinking";
  return (
    <div
      className={tone === "error" ? "cn-thinking-row error" : "cn-thinking-row"}
      role="status"
      aria-live="polite"
    >
      <span>{props.text}</span>
    </div>
  );
}
