"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatItem, LocalSessionSummary } from "../../lib/types";
import { buildChatTailSignature } from "../../lib/format/text";
import type { ResumeState } from "../../features/chat/chat-state";
import { CommandOutputBlock } from "./CommandOutputBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownMessage } from "./MarkdownMessage";
import { PlanBlock } from "./PlanBlock";
import { SystemStatusRow } from "./SystemStatusRow";

export function ChatCanvas(props: {
  active: boolean;
  items: ChatItem[];
  pendingApprovals: number;
  resumeState: ResumeState | null;
  session: LocalSessionSummary;
  onOpenApproval: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const previousSessionRef = useRef<string | null>(null);
  const previousTailRef = useRef("");
  const [showJumpButton, setShowJumpButton] = useState(false);

  const tailSignature = buildChatTailSignature(props.items.at(-1));
  const visibleItems = useMemo(
    () => (props.items.length > 150 ? props.items.slice(-150) : props.items),
    [props.items]
  );
  const hiddenCount = Math.max(0, props.items.length - visibleItems.length);

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
    } else if (tailChanged && !pinnedRef.current) {
      setShowJumpButton(true);
    }

    previousSessionRef.current = props.session.sessionId;
    previousTailRef.current = tailSignature;
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
            <button className="cn-soft-button danger" type="button" onClick={props.onOpenApproval}>
              {props.pendingApprovals} 个审批请求
            </button>
          ) : null}
        </div>
      ) : null}

      {props.items.length > 0 ? (
        <>
          {hiddenCount > 0 ? (
            <div className="cn-history-fold-chip">已折叠 {hiddenCount} 条更早消息</div>
          ) : null}
          <div className="cn-message-list">
            {visibleItems.map((item) => (
              <ChatMessageRow key={item.id} item={item} />
            ))}
          </div>
        </>
      ) : null}

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
          <MarkdownMessage text={props.item.text} />
          {props.item.status && props.item.status !== "sent" ? (
            props.item.status === "sending" ? (
              <span className="cn-message-status sending" aria-label="发送中">
                <span className="cn-pending-dots">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            ) : (
              <span className={`cn-message-status ${props.item.status}`}>
                {statusCopy(props.item)}
              </span>
            )
          ) : null}
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

function statusCopy(item: ChatItem): string {
  if (item.status === "failed") {
    return item.error ? `发送失败 · ${item.error}` : "发送失败";
  }
  return "";
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
