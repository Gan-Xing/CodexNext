import type { PendingApprovalView } from "../lib/types";

export function ApprovalPanel(props: {
  approvals: PendingApprovalView[];
  onDecision: (approvalId: string, decision: string) => void;
}) {
  return (
    <section
      className={
        props.approvals.length > 0
          ? "inspector-panel approval-panel hot"
          : "inspector-panel approval-panel"
      }
    >
      <div className="section-heading">
        <span>批准</span>
        <span className="count-badge">{props.approvals.length}</span>
      </div>

      {props.approvals.length === 0 ? (
        <div className="empty-small">暂无请求</div>
      ) : (
        <div className="stack">
          {props.approvals.map((approval) => (
            <article key={approval.approvalId} className="approval-card">
              <div>
                <p className="eyebrow">{approval.method}</p>
                <h3>{approvalTitle(approval.params)}</h3>
                <div className="meta">{approvalCwd(approval.params) ?? "cwd unknown"}</div>
              </div>
              <details>
                <summary>详情</summary>
                <pre>{JSON.stringify(approval.params, null, 2)}</pre>
              </details>
              <div className="approval-actions">
                <button
                  type="button"
                  onClick={() => props.onDecision(approval.approvalId, "accept")}
                >
                  允许一次
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    props.onDecision(approval.approvalId, "acceptForSession")
                  }
                >
                  本会话允许
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onDecision(approval.approvalId, "decline")}
                >
                  拒绝
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => props.onDecision(approval.approvalId, "cancel")}
                >
                  取消
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function approvalTitle(params: unknown): string {
  const record = asRecord(params);
  if (!record) {
    return "需要批准";
  }
  const command = readString(record, "command") ?? readString(record, "cmd");
  if (command) {
    return command;
  }
  const path = readString(record, "path") ?? readString(record, "filePath");
  if (path) {
    return path;
  }
  return "需要批准";
}

function approvalCwd(params: unknown): string | null {
  const record = asRecord(params);
  if (!record) {
    return null;
  }
  return readString(record, "cwd") ?? readString(record, "workdir") ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}
