"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatItem, LocalSessionSummary } from "../../lib/types";
import { buildChatTailSignature } from "../../lib/format/text";
import type { ResumeState } from "../../features/chat/chat-state";
import { CommandOutputBlock } from "./CommandOutputBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageCopyButton } from "./MessageCopyButton";
import { PlanBlock } from "./PlanBlock";
import { SystemStatusRow } from "./SystemStatusRow";
import { ThinkingRow } from "./ThinkingRow";

export function ChatCanvas(props: {
  active: boolean;
  canLoadOlderHistory?: boolean;
  items: ChatItem[];
  loadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void;
  pendingApprovals: number;
  resumeState: ResumeState | null;
  session: LocalSessionSummary;
  onOpenSummary: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const previousSessionRef = useRef<string | null>(null);
  const previousTailRef = useRef("");
  const previousHeightRef = useRef(0);
  const previousLengthRef = useRef(0);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const tailSignature = buildChatTailSignature(props.items.at(-1));
  const visibleItems = useMemo(() => props.items, [props.items]);
  const activeTurnId = props.active ? props.session.activeTurnId ?? null : null;
  const showThinkingRow = shouldShowThinkingRow(visibleItems, activeTurnId, props.active);

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
    };

    commit();
    viewport.addEventListener("scroll", commit, { passive: true });
    return () => viewport.removeEventListener("scroll", commit);
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

  const showStatusStrip = Boolean(
    props.active ||
      props.resumeState === "resuming" ||
      props.pendingApprovals > 0
  );

  return (
    <section className="cn-thread-canvas cn-live-thread" ref={viewportRef}>
      {showStatusStrip ? (
        <div className="cn-thread-status-strip">
          {props.active || props.resumeState === "resuming" ? (
            <span className="cn-run-status running">
              {props.resumeState === "resuming" ? "正在恢复" : "正在运行"}
            </span>
          ) : null}
          {props.pendingApprovals > 0 ? (
            <button className="cn-soft-button danger" type="button" onClick={props.onOpenSummary}>
              {props.pendingApprovals} 个审批请求
            </button>
          ) : null}
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
          <div className="cn-message-list">
            {visibleItems.flatMap((item) => {
              const rows = [<ChatMessageRow key={item.id} item={item} />];
              if (item.role === "user" && item.status === "failed") {
                rows.push(
                  <ThinkingRow
                    key={`${item.id}:error`}
                    tone="error"
                    text={item.error ?? "发送失败"}
                  />
                );
              }
              return rows;
            })}
            {showThinkingRow ? <ThinkingRow key="thinking" text="正在思考" /> : null}
          </div>
        </>
      ) : (
        <div className="cn-thread-empty">
          <strong>正在恢复这条会话</strong>
          <span>侧栏已经恢复，消息内容会在后台继续同步，不需要重新点一次。</span>
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
  return (
    <article className={`cn-message ${messageClass(props.item)}`}>
      {props.item.role === "user" ? (
        <div className="cn-message-user-shell">
          <div className="cn-message-user-bubble">
            <MarkdownMessage text={props.item.text} />
          </div>
          {props.item.status !== "sending" ? <MessageCopyButton value={props.item.text} /> : null}
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

function shouldShowThinkingRow(
  items: ChatItem[],
  activeTurnId: string | null,
  active: boolean
): boolean {
  if (!active) {
    return false;
  }
  const activeItems =
    activeTurnId == null
      ? items.slice(-4)
      : items.filter((item) => item.turnId === activeTurnId);

  if (activeItems.length === 0) {
    return true;
  }

  const hasError = activeItems.some(
    (item) =>
      item.status === "failed" ||
      (item.role === "system" && item.meta?.kind === "error")
  );
  if (hasError) {
    return false;
  }

  return !activeItems.some(
    (item) =>
      (item.role === "assistant" ||
        item.role === "command" ||
        item.role === "diff" ||
        item.role === "plan") &&
      item.text.trim().length > 0
  );
}
