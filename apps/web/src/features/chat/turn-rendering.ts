import type { TurnGroup, TurnGroupItem } from "./chat-state";

export type ChatRenderItemRole =
  | "user"
  | "assistant"
  | "command"
  | "system"
  | "diff"
  | "plan";

export type ChatRenderItemStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "streaming"
  | "complete";

export interface ChatRenderItem {
  clientMessageId?: string | undefined;
  createdAt?: number | undefined;
  error?: string | undefined;
  id: string;
  itemId: string;
  kind: TurnGroupItem["kind"];
  meta?: {
    appServerItemId?: string | undefined;
    appServerItemType?: string | undefined;
    clientMessageId?: string | undefined;
    kind?: "thinking" | "error" | "legacy" | undefined;
    payload?: unknown;
    source?: "turn-store" | "legacy" | undefined;
    turnStatus?: string | undefined;
  } | undefined;
  role: ChatRenderItemRole;
  status: ChatRenderItemStatus;
  text: string;
  turnId: string;
  type: string;
}

export type ChatRenderRow =
  | {
      id: string;
      item: ChatRenderItem;
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
  fallbackItems: ChatRenderItem[];
  turnGroups: TurnGroup[] | undefined;
}): ChatRenderRow[] {
  const { expandedProcessTurnIds, fallbackItems, turnGroups } = input;
  if (!turnGroups || turnGroups.length === 0) {
    return fallbackItems.map(chatRenderItemToRenderRow);
  }
  const rows = turnGroups.flatMap((group) =>
    deriveTurnGroupRows(group, expandedProcessTurnIds.has(group.id))
  );
  return rows.length > 0 ? rows : fallbackItems.map(chatRenderItemToRenderRow);
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
    return group.items.flatMap((item) => turnGroupItemToRenderRows(group, item));
  }

  const processRows = group.processItems.flatMap((item) =>
    turnGroupItemToRenderRows(group, item)
  );
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
    ...group.userItems.flatMap((item) => turnGroupItemToRenderRows(group, item)),
    summaryRow,
    ...(summaryRow.expanded ? processRows : []),
    ...group.answerItems.flatMap((item) => turnGroupItemToRenderRows(group, item)),
    ...group.metadataItems.flatMap((item) => turnGroupItemToRenderRows(group, item))
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
    item.metaKind === "error"
  );
}

function turnGroupItemToRenderRows(group: TurnGroup, item: TurnGroupItem): ChatRenderRow[] {
  const renderItem = turnGroupItemToChatRenderItem(group, item);
  return renderItem ? [chatRenderItemToRenderRow(renderItem)] : [];
}

function chatRenderItemToRenderRow(item: ChatRenderItem): ChatRenderRow {
  return {
    id: item.id,
    kind: "item",
    item
  };
}

export function chatRenderItemsFromTurnGroups(turnGroups: TurnGroup[]): ChatRenderItem[] {
  return turnGroups.flatMap((group) =>
    group.items
      .map((item) => turnGroupItemToChatRenderItem(group, item))
      .filter((item): item is ChatRenderItem => Boolean(item))
  );
}

function turnGroupItemToChatRenderItem(
  group: TurnGroup,
  item: TurnGroupItem
): ChatRenderItem | null {
  if (!item.role || item.text.trim().length === 0) {
    return null;
  }
  if (item.metaKind === "thinking" && turnGroupHasRenderableResponse(group)) {
    return null;
  }
  return {
    id: `turn-${group.id}-${item.id}`,
    turnId: group.id,
    itemId: item.id,
    kind: item.kind,
    type: item.type,
    role: item.role,
    text: item.text,
    status: item.status ?? "complete",
    ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
    ...(item.error ? { error: item.error } : {}),
    meta: {
      appServerItemId: item.id,
      appServerItemType: item.type,
      source: "turn-store",
      turnStatus: item.turnStatus,
      ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
      ...(item.metaKind ? { kind: item.metaKind } : {}),
      ...(item.content !== undefined ? { payload: item.content } : {})
    }
  };
}

function turnGroupHasRenderableResponse(group: TurnGroup): boolean {
  return group.items.some((item) =>
    Boolean(
      item.role &&
        (item.role === "assistant" || item.role === "command" || item.role === "diff") &&
        item.text.trim().length > 0 &&
        item.metaKind !== "error"
    )
  );
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
