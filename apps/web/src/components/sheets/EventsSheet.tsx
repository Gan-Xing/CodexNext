import type { LocalApprovalDecision, LocalEvent, PendingApprovalView } from "../../lib/types";
import { summarizeApproval } from "../../features/events/approval-utils";
import { CodexIcon } from "../DesignLab";

export function EventsSheet(props: {
  events: LocalEvent[];
  pendingApprovals: PendingApprovalView[];
  onClose: () => void;
  onDecision: (approvalId: string, decision: LocalApprovalDecision) => void;
}) {
  const visibleEvents = props.events.filter(
    (event) => event.type !== "codex.notification"
  );

  return (
    <div className="cn-overlay-panel cn-live-overlay right">
      <section className="cn-events-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>活动</h2>
        {props.pendingApprovals.length > 0 ? (
          <div className="cn-events-approval-list">
            {props.pendingApprovals.map((approval) => {
              const summary = summarizeApproval(approval);
              return (
                <article key={approval.approvalId} className="cn-event-approval-card">
                  <strong>{summary.title}</strong>
                  <span>{summary.typeLabel}</span>
                  <div className="cn-approval-actions">
                    <button
                      className="cn-primary-button"
                      type="button"
                      onClick={() => props.onDecision(approval.approvalId, "accept")}
                    >
                      允许一次
                    </button>
                    <button
                      className="cn-soft-button"
                      type="button"
                      onClick={() =>
                        props.onDecision(approval.approvalId, "acceptForSession")
                      }
                    >
                      本会话允许
                    </button>
                    <button
                      className="cn-soft-button"
                      type="button"
                      onClick={() => props.onDecision(approval.approvalId, "decline")}
                    >
                      拒绝
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        <div className="cn-event-list">
          {visibleEvents
            .slice()
            .reverse()
            .slice(0, 120)
            .map((event) => (
              <details key={event.seq} className="cn-event-row">
                <summary>
                  <span>#{event.seq}</span>
                  <strong>{event.type}</strong>
                </summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
        </div>
      </section>
    </div>
  );
}
