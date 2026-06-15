import type { ChatItem } from "../../lib/types";
import type { TurnGroup, TurnGroupItem } from "./chat-state";

export type ChatRenderRow =
  | {
      id: string;
      item: ChatItem;
      kind: "item";
    }
  | {
      durationLabel: string;
      expandable: boolean;
      expanded: boolean;
      id: string;
      itemCount: number;
      kind: "processSummary";
      label: string;
      turnId: string;
    };

export function deriveChatRenderRows(input: {
  expandedProcessTurnIds: ReadonlySet<string>;
  fallbackItems: ChatItem[];
  turnGroups: TurnGroup[] | undefined;
}): ChatRenderRow[] {
  const { expandedProcessTurnIds, fallbackItems, turnGroups } = input;
  if (!turnGroups || turnGroups.length === 0) {
    return fallbackItems.map(chatItemToRenderRow);
  }
  const rows = turnGroups.flatMap((group) =>
    deriveTurnGroupRows(group, expandedProcessTurnIds.has(group.id))
  );
  return rows.length > 0 ? rows : fallbackItems.map(chatItemToRenderRow);
}

export function renderRowTailSignature(row: ChatRenderRow | undefined): string {
  if (!row) {
    return "";
  }
  if (row.kind === "item") {
    return `${row.id}:${row.item.status ?? ""}:${row.item.text.length}:${row.item.text.slice(-80)}`;
  }
  return `${row.id}:${row.label}:${row.expanded ? "open" : "closed"}`;
}

function deriveTurnGroupRows(
  group: TurnGroup,
  processExpanded: boolean
): ChatRenderRow[] {
  if (!shouldFoldProcess(group)) {
    return group.items.flatMap(turnGroupItemToRenderRows);
  }

  const processRows = group.processItems.flatMap(turnGroupItemToRenderRows);
  const summaryRow: ChatRenderRow = {
    id: `turn-${group.id}-process-summary`,
    kind: "processSummary",
    turnId: group.id,
    label: processSummaryLabel(group),
    durationLabel: processDurationLabel(group.durationMs),
    itemCount: group.processItems.length,
    expandable: processRows.length > 0,
    expanded: processRows.length > 0 && processExpanded
  };

  return [
    ...group.userItems.flatMap(turnGroupItemToRenderRows),
    summaryRow,
    ...(summaryRow.expanded ? processRows : []),
    ...group.answerItems.flatMap(turnGroupItemToRenderRows),
    ...group.metadataItems.flatMap(turnGroupItemToRenderRows)
  ];
}

function shouldFoldProcess(group: TurnGroup): boolean {
  return (
    group.status === "complete" &&
    group.processItems.length > 0 &&
    group.error === null &&
    !group.items.some(isBlockingProcessItem)
  );
}

function isBlockingProcessItem(item: TurnGroupItem): boolean {
  return (
    item.status === "failed" ||
    item.type.toLocaleLowerCase().includes("approval") ||
    item.chatItem?.meta?.kind === "error"
  );
}

function turnGroupItemToRenderRows(item: TurnGroupItem): ChatRenderRow[] {
  return item.chatItem ? [chatItemToRenderRow(item.chatItem)] : [];
}

function chatItemToRenderRow(item: ChatItem): ChatRenderRow {
  return {
    id: item.id,
    kind: "item",
    item
  };
}

function processSummaryLabel(group: TurnGroup): string {
  const duration = processDurationLabel(group.durationMs);
  return duration ? `已处理 ${duration}` : "已处理";
}

function processDurationLabel(durationMs: number | null): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "";
  }
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
