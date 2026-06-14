"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatItem, LocalSessionSummary } from "../../lib/types";
import { buildChatTailSignature } from "../../lib/format/text";
import { CommandOutputBlock } from "./CommandOutputBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageCopyButton } from "./MessageCopyButton";
import { PlanBlock } from "./PlanBlock";
import { SystemStatusRow } from "./SystemStatusRow";
import { ThinkingRow } from "./ThinkingRow";

const VIRTUALIZE_AFTER_ITEMS = 80;
const VIRTUAL_OVERSCAN_ITEMS = 10;
const VIRTUAL_ROW_GAP = 16;
const BOTTOM_STICK_WINDOW_MS = 1_000;

export function ChatCanvas(props: {
  active: boolean;
  blockedNotice?: {
    body: string;
    title: string;
  } | null;
  canLoadOlderHistory?: boolean;
  items: ChatItem[];
  loadingInitialHistory?: boolean;
  loadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void;
  pendingApprovals: number;
  session: LocalSessionSummary;
  threadSubtitle?: string;
  threadTitle?: string;
  onOpenSummary: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const previousSessionRef = useRef<string | null>(null);
  const previousTailRef = useRef("");
  const previousHeightRef = useRef(0);
  const previousLengthRef = useRef(0);
  const bottomStickUntilRef = useRef(0);
  const bottomStickFrameRef = useRef<number | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const tailSignature = buildChatTailSignature(props.items.at(-1));
  const visibleItems = useMemo(() => props.items, [props.items]);
  const shouldVirtualize = visibleItems.length > VIRTUALIZE_AFTER_ITEMS;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleItems.length : 0,
    estimateSize: (index) => estimateItemHeight(visibleItems[index] ?? null),
    gap: VIRTUAL_ROW_GAP,
    getItemKey: (index) => visibleItems[index]?.id ?? index,
    getScrollElement: () => viewportRef.current,
    overscan: VIRTUAL_OVERSCAN_ITEMS
  });
  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const virtualTotalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;

  const scrollToBottomNow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    if (shouldVirtualize && visibleItems.length > 0) {
      rowVirtualizer.scrollToIndex(visibleItems.length - 1, {
        align: "end"
      });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
    pinnedRef.current = true;
    setShowJumpButton(false);
    previousHeightRef.current = viewport.scrollHeight;
  }, [rowVirtualizer, shouldVirtualize, visibleItems.length]);

  const scheduleBottomStick = useCallback(() => {
    const run = () => {
      bottomStickFrameRef.current = null;
      if (bottomStickUntilRef.current <= Date.now()) {
        return;
      }
      scrollToBottomNow();
    };
    if (bottomStickFrameRef.current !== null) {
      cancelAnimationFrame(bottomStickFrameRef.current);
    }
    if (typeof requestAnimationFrame === "undefined") {
      run();
      return;
    }
    bottomStickFrameRef.current = requestAnimationFrame(run);
  }, [scrollToBottomNow]);

  const beginBottomStick = useCallback(() => {
    bottomStickUntilRef.current = Date.now() + BOTTOM_STICK_WINDOW_MS;
    scrollToBottomNow();
    scheduleBottomStick();
  }, [scheduleBottomStick, scrollToBottomNow]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const commit = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const isPinned = distanceFromBottom < 56;
      pinnedRef.current = isPinned;
      setShowJumpButton(!isPinned);
    };
    const cancelBottomStick = () => {
      bottomStickUntilRef.current = 0;
    };

    commit();
    const handleScroll = () => commit();
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    viewport.addEventListener("wheel", cancelBottomStick, { passive: true });
    viewport.addEventListener("touchstart", cancelBottomStick, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => commit())
        : null;
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      viewport.removeEventListener("wheel", cancelBottomStick);
      viewport.removeEventListener("touchstart", cancelBottomStick);
      observer?.disconnect();
    };
  }, [props.session.sessionId]);

  useEffect(() => {
    return () => {
      if (bottomStickFrameRef.current !== null) {
        cancelAnimationFrame(bottomStickFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const sessionChanged = previousSessionRef.current !== props.session.sessionId;
    const tailChanged = previousTailRef.current !== tailSignature;

    if (sessionChanged || (tailChanged && pinnedRef.current)) {
      beginBottomStick();
    } else if (!tailChanged && visibleItems.length > previousLengthRef.current) {
      const delta = viewport.scrollHeight - previousHeightRef.current;
      if (delta > 0) {
        viewport.scrollTop += delta;
      }
    } else if (tailChanged && !pinnedRef.current) {
      setShowJumpButton(true);
    }

    previousSessionRef.current = props.session.sessionId;
    previousTailRef.current = tailSignature;
    previousHeightRef.current = viewport.scrollHeight;
    previousLengthRef.current = visibleItems.length;
  }, [beginBottomStick, props.session.sessionId, tailSignature, visibleItems.length]);

  useLayoutEffect(() => {
    if (bottomStickUntilRef.current <= Date.now()) {
      return;
    }
    scheduleBottomStick();
  }, [
    scheduleBottomStick,
    shouldVirtualize,
    tailSignature,
    virtualTotalSize,
    visibleItems.length
  ]);

  return (
    <section className="cn-thread-canvas cn-live-thread" ref={viewportRef}>
      {props.pendingApprovals > 0 ? (
        <div className="cn-thread-status-strip">
          <button className="cn-soft-button danger" type="button" onClick={props.onOpenSummary}>
            {props.pendingApprovals} 个审批请求
          </button>
        </div>
      ) : null}

      {props.blockedNotice ? (
        <div className="cn-thread-blocked-notice" role="status">
          <strong>{props.blockedNotice.title}</strong>
          <span>{props.blockedNotice.body}</span>
        </div>
      ) : null}

      {props.items.length > 0 ? (
        <>
          {props.canLoadOlderHistory || props.loadingOlderHistory ? (
            <div className="cn-history-pagination">
              <button
                className="cn-history-load-more"
                type="button"
                onClick={props.onLoadOlderHistory}
                disabled={props.loadingOlderHistory}
              >
                {props.loadingOlderHistory ? "正在加载更早消息…" : "加载更早消息"}
              </button>
            </div>
          ) : null}
          {shouldVirtualize ? (
            <div
              className="cn-message-virtual-list"
              style={{ height: `${virtualTotalSize}px` }}
            >
              {virtualItems.map((virtualItem) => {
                const item = visibleItems[virtualItem.index];
                if (!item) {
                  return null;
                }
                return (
                  <div
                    key={virtualItem.key}
                    ref={rowVirtualizer.measureElement}
                    className="cn-message-virtual-row"
                    data-index={virtualItem.index}
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <ChatMessageRow item={item} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cn-message-list">
              {visibleItems.map((item) => (
                <ChatMessageRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </>
      ) : props.blockedNotice ? null : props.loadingInitialHistory ? (
        <div className="cn-thread-loading-skeleton" role="status">
          <strong>{props.threadTitle ?? "正在打开这条对话"}</strong>
          <span>{props.threadSubtitle ?? "先显示本地缓存，后台同步最新消息。"}</span>
          <div className="cn-thread-loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : (
        <div className="cn-thread-empty">
          <strong>继续在这里工作</strong>
          <span>直接在下方输入即可，不需要先处理这些运行状态提示。</span>
        </div>
      )}

      <div ref={endRef} className="cn-thread-end" />

      {showJumpButton ? (
        <div className="cn-thread-jump-wrap">
          <button
            className="cn-thread-jump"
            type="button"
            onClick={() => {
              const viewport = viewportRef.current;
              if (!viewport) {
                return;
              }
              viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
              pinnedRef.current = true;
              setShowJumpButton(false);
            }}
          >
            回到底部 <strong>↓</strong>
          </button>
        </div>
      ) : null}
    </section>
  );
}

const ChatMessageRow = memo(function ChatMessageRow(props: {
  item: ChatItem;
}) {
  const feedback = optimisticFeedback(props.item);
  if (feedback) {
    return <ThinkingRow text={feedback.text} tone={feedback.tone} />;
  }
  return (
    <article className={`cn-message ${messageClass(props.item)}`}>
      {props.item.role === "user" ? (
        <div className="cn-message-user-shell">
          <div className="cn-message-user-bubble">
            <MarkdownMessage text={props.item.text} />
            {props.item.status !== "sending" && props.item.status !== "pending" ? (
              <MessageCopyButton value={props.item.text} />
            ) : null}
          </div>
        </div>
      ) : props.item.role === "assistant" ? (
        <MarkdownMessage text={props.item.text} />
      ) : props.item.role === "command" ? (
        <CommandOutputBlock text={props.item.text} />
      ) : props.item.role === "diff" ? (
        <DiffBlock diff={props.item.text} />
      ) : props.item.role === "plan" ? (
        <PlanBlock item={props.item} />
      ) : (
        <SystemStatusRow item={props.item} />
      )}
    </article>
  );
});

function optimisticFeedback(item: ChatItem): {
  text: string;
  tone: "thinking" | "error";
} | null {
  if (item.role !== "system") {
    return null;
  }
  if (item.meta?.kind === "thinking") {
    return {
      text: item.text,
      tone: "thinking"
    };
  }
  if (item.meta?.kind === "error") {
    return {
      text: item.text,
      tone: "error"
    };
  }
  return null;
}

function messageClass(item: ChatItem): string {
  if (item.role === "assistant") {
    return "assistant";
  }
  if (item.role === "command") {
    return "command";
  }
  if (item.role === "diff") {
    return "diff";
  }
  if (item.role === "plan" || item.role === "system") {
    return "system";
  }
  if (item.status === "failed") {
    return "user failed";
  }
  return "user";
}

function estimateItemHeight(item: ChatItem | null | undefined): number {
  if (!item) {
    return 120;
  }
  const base = item.role === "user" ? 58 : 72;
  const textLines = Math.max(1, Math.ceil(item.text.length / 86));
  const blockBoost =
    item.role === "command" || item.role === "diff" || item.role === "plan"
      ? 88
      : 0;
  return Math.min(620, base + textLines * 22 + blockBoost);
}
