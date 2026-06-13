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
const VIRTUAL_OVERSCAN_PX = 900;
const VIRTUAL_ROW_GAP = 16;

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
  const itemHeightsRef = useRef(new Map<string, number>());
  const pinnedRef = useRef(true);
  const previousSessionRef = useRef<string | null>(null);
  const previousTailRef = useRef("");
  const previousHeightRef = useRef(0);
  const previousLengthRef = useRef(0);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [virtualViewport, setVirtualViewport] = useState({
    height: 0,
    scrollTop: 0
  });

  const tailSignature = buildChatTailSignature(props.items.at(-1));
  const visibleItems = useMemo(() => props.items, [props.items]);
  const shouldVirtualize = visibleItems.length > VIRTUALIZE_AFTER_ITEMS;
  const virtualRows = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        rows: [],
        totalHeight: 0
      };
    }
    let top = 0;
    const rows = visibleItems.map((item, index) => {
      const height = itemHeightsRef.current.get(item.id) ?? estimateItemHeight(item);
      const row = {
        height,
        index,
        item,
        top
      };
      top += height + VIRTUAL_ROW_GAP;
      return row;
    });
    return {
      rows,
      totalHeight: Math.max(0, top - VIRTUAL_ROW_GAP)
    };
  }, [measurementVersion, shouldVirtualize, visibleItems]);
  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        endIndex: visibleItems.length,
        startIndex: 0
      };
    }
    const startPx = Math.max(0, virtualViewport.scrollTop - VIRTUAL_OVERSCAN_PX);
    const endPx =
      virtualViewport.scrollTop +
      Math.max(virtualViewport.height, 560) +
      VIRTUAL_OVERSCAN_PX;
    const startIndex = Math.max(
      0,
      virtualRows.rows.findIndex((row) => row.top + row.height >= startPx)
    );
    const endCandidate = virtualRows.rows.findIndex((row) => row.top > endPx);
    return {
      startIndex,
      endIndex: endCandidate === -1 ? virtualRows.rows.length : endCandidate + 1
    };
  }, [shouldVirtualize, virtualRows.rows, virtualViewport.height, virtualViewport.scrollTop, visibleItems.length]);
  const virtualItems = shouldVirtualize
    ? virtualRows.rows.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : [];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const commit = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      pinnedRef.current = distanceFromBottom < 56;
      setShowJumpButton(!pinnedRef.current);
      setVirtualViewport((current) => {
        const next = {
          height: viewport.clientHeight,
          scrollTop: viewport.scrollTop
        };
        return current.height === next.height && current.scrollTop === next.scrollTop
          ? current
          : next;
      });
    };

    commit();
    viewport.addEventListener("scroll", commit, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(commit)
        : null;
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", commit);
      observer?.disconnect();
    };
  }, [props.session.sessionId]);

  useEffect(() => {
    itemHeightsRef.current.clear();
    setMeasurementVersion((version) => version + 1);
  }, [props.session.sessionId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const sessionChanged = previousSessionRef.current !== props.session.sessionId;
    const tailChanged = previousTailRef.current !== tailSignature;

    if (sessionChanged || (tailChanged && pinnedRef.current)) {
      viewport.scrollTop = viewport.scrollHeight;
      pinnedRef.current = true;
      setShowJumpButton(false);
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
  }, [props.session.sessionId, tailSignature, visibleItems.length]);

  const handleMeasure = useCallback((id: string, height: number) => {
    const rounded = Math.ceil(height);
    const current = itemHeightsRef.current.get(id);
    if (current !== undefined && Math.abs(current - rounded) < 2) {
      return;
    }
    itemHeightsRef.current.set(id, rounded);
    setMeasurementVersion((version) => version + 1);
  }, []);

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
              style={{ height: `${virtualRows.totalHeight}px` }}
            >
              {virtualItems.map((row) => (
                <MeasuredVirtualMessageRow
                  key={row.item.id}
                  item={row.item}
                  top={row.top}
                  onMeasure={handleMeasure}
                />
              ))}
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

const MeasuredVirtualMessageRow = memo(function MeasuredVirtualMessageRow(props: {
  item: ChatItem;
  onMeasure: (id: string, height: number) => void;
  top: number;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const measure = () => props.onMeasure(props.item.id, row.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [props.item.id, props.onMeasure]);

  return (
    <div
      ref={rowRef}
      className="cn-message-virtual-row"
      style={{ transform: `translateY(${props.top}px)` }}
    >
      <ChatMessageRow item={props.item} />
    </div>
  );
});

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

function estimateItemHeight(item: ChatItem): number {
  const base = item.role === "user" ? 58 : 72;
  const textLines = Math.max(1, Math.ceil(item.text.length / 86));
  const blockBoost =
    item.role === "command" || item.role === "diff" || item.role === "plan"
      ? 88
      : 0;
  return Math.min(620, base + textLines * 22 + blockBoost);
}
