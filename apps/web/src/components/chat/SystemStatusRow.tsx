import type { ChatItem } from "../../lib/types";

export function SystemStatusRow(props: {
  item: ChatItem;
}) {
  const tone =
    props.item.meta?.kind === "error"
      ? "danger"
      : props.item.meta?.turnStatus === "failed"
        ? "danger"
        : props.item.meta?.turnStatus === "interrupted"
          ? "muted"
          : "ok";

  return <div className={`cn-system-status-row ${tone}`}>{props.item.text}</div>;
}
