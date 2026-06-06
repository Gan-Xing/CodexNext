import { useState } from "react";
import type { ThreadGoal } from "@codexnext/protocol";
import type { ChatItem, LocalSessionSummary } from "../lib/types";

export function ChatPanel(props: {
  items: ChatItem[];
  session: LocalSessionSummary;
  goal: ThreadGoal | null;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}) {
  const [text, setText] = useState("");
  const active = Boolean(props.session.activeTurnId);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    props.onSend(trimmed);
    setText("");
  }

  return (
    <section className="chat-stage">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Thread</p>
          <h1>{shortPath(props.session.cwd)}</h1>
        </div>
        <div className="header-chips">
          {props.goal ? (
            <span className={`goal-chip ${props.goal.status}`}>
              Goal {props.goal.status}
            </span>
          ) : (
            <span className="goal-chip muted">No Goal</span>
          )}
          <span className={active ? "run-chip running" : "run-chip"}>
            {active ? "Running" : props.session.status}
          </span>
        </div>
      </header>

      <div className="chat-log">
        {props.items.length === 0 ? (
          <div className="empty-chat">
            <h2>会话已准备好</h2>
            <p>发送第一条消息会调用 turn/start；运行中发送会调用 turn/steer。</p>
          </div>
        ) : (
          props.items.map((item) => (
            <article key={item.id} className={`chat-item ${item.role}`}>
              <div className="chat-role">{roleLabel(item.role)}</div>
              <div className="chat-text">{item.text}</div>
            </article>
          ))
        )}
      </div>

      <footer className="composer-dock">
        <textarea
          placeholder={active ? "补充方向，steer 当前 turn..." : "问 CodexNext 一件具体的事..."}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              submit();
            }
          }}
        />
        <div className="composer-footer">
          <div className="meta">
            {active ? "Active turn will receive turn/steer." : "Idle thread will start a new turn."}
          </div>
          <div className="row compact">
            <button
              className="secondary"
              type="button"
              onClick={props.onInterrupt}
              disabled={!active}
            >
              Interrupt
            </button>
            <button type="button" onClick={submit} disabled={!text.trim()}>
              {active ? "Steer" : "Send"}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}

function roleLabel(role: ChatItem["role"]): string {
  if (role === "assistant") {
    return "Codex";
  }
  if (role === "command") {
    return "Command output";
  }
  if (role === "diff") {
    return "Diff";
  }
  if (role === "system") {
    return "System";
  }
  return "You";
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}
