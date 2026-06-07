import type { LocalApprovalDecision, PendingApprovalView } from "../../lib/types";
import { summarizeApproval } from "../../features/events/approval-utils";
import { CopyButton } from "../chat/CopyButton";

export function ApprovalModal(props: {
  approval: PendingApprovalView;
  onDecision: (decision: LocalApprovalDecision) => void;
}) {
  const summary = summarizeApproval(props.approval);

  return (
    <div className="cn-approval-backdrop cn-real-approval-backdrop">
      <section className="cn-approval-modal cn-approval-action-card">
        <div className="cn-approval-heading">
          <div>
            <h2>需要批准</h2>
            <p>{summary.typeLabel}</p>
          </div>
          {summary.command ? <CopyButton label="复制命令" value={summary.command} /> : null}
        </div>

        <div className="cn-approval-summary-grid">
          <div>
            <span>内容</span>
            <strong>{summary.title}</strong>
          </div>
          {summary.cwd ? (
            <div>
              <span>cwd</span>
              <strong>{summary.cwd}</strong>
            </div>
          ) : null}
          {summary.reason ? (
            <div>
              <span>原因</span>
              <strong>{summary.reason}</strong>
            </div>
          ) : null}
          {summary.filePath ? (
            <div>
              <span>文件</span>
              <strong>{summary.filePath}</strong>
            </div>
          ) : null}
          {summary.grantRoot ? (
            <div>
              <span>授权根目录</span>
              <strong>{summary.grantRoot}</strong>
            </div>
          ) : null}
          {summary.host || summary.protocol ? (
            <div>
              <span>网络</span>
              <strong>{[summary.protocol, summary.host].filter(Boolean).join(" · ")}</strong>
            </div>
          ) : null}
          <div>
            <span>可用决策</span>
            <strong>{summary.availableDecisions.join(" / ")}</strong>
          </div>
        </div>

        <details className="cn-approval-raw-details">
          <summary>详情</summary>
          <pre>{JSON.stringify(props.approval.params, null, 2)}</pre>
        </details>

        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button" onClick={() => props.onDecision("accept")}>
            允许一次
          </button>
          <button
            className="cn-soft-button"
            type="button"
            onClick={() => props.onDecision("acceptForSession")}
          >
            本会话允许
          </button>
          <button className="cn-soft-button" type="button" onClick={() => props.onDecision("decline")}>
            拒绝
          </button>
          <button className="cn-soft-button wide" type="button" onClick={() => props.onDecision("cancel")}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
