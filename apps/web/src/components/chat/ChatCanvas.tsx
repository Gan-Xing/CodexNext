"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatItem, LocalSessionSummary } from "../../lib/types";
import { buildChatTailSignature } from "../../lib/format/text";
import { CommandOutputBlock } from "./CommandOutputBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageCopyButton } from "./MessageCopyButton";
import { PlanBlock } from "./PlanBlock";
import { SystemStatusRow } from "./SystemStatusRow";

export function ChatCanvas(props: {
  active: boolean;
  canLoadOlderHistory?: boolean;
  items: ChatItem[];
  loadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void;
  pendingApprovals: number;
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

  return (
    <section className="cn-thread-canvas cn-live-thread" ref={viewportRef}>
      {props.pendingApprovals > 0 ? (
        <div className="cn-thread-status-strip">
          <button className="cn-soft-button danger" type="button" onClick={props.onOpenSummary}>
            {props.pendingApprovals} 个审批请求
          </button>
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
            {visibleItems.map((item) => (
              <ChatMessageRow key={item.id} item={item} />
            ))}
          </div>
        </>
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
