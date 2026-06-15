"use client";

import { useMemo, useState } from "react";
import type {
  LocalApprovalDecision,
  LocalEvent,
  PendingApprovalView
} from "../../lib/types";
import type { TurnGroup } from "../../features/chat/chat-state";
import { summarizeApproval } from "../../features/events/approval-utils";
import {
  buildSummaryPanelData,
  summaryVisibleRows,
  type SummaryOutputItem,
  type SummaryTaskItem
} from "../../features/summary/summary-panel";
import { chatRenderItemsFromTurnGroups } from "../../features/chat/turn-rendering";
import { CodexIcon } from "../DesignLab";

export function SummarySheet(props: {
  turnGroups: TurnGroup[];
  events: LocalEvent[];
  pendingApprovals: PendingApprovalView[];
  onClose: () => void;
  onDecision: (approvalId: string, decision: LocalApprovalDecision) => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const summaryRenderItems = useMemo(
    () => chatRenderItemsFromTurnGroups(props.turnGroups),
    [props.turnGroups]
  );
  const data = useMemo(
    () =>
      buildSummaryPanelData({
        renderItems: summaryRenderItems,
        events: props.events,
        pendingApprovals: props.pendingApprovals
      }),
    [summaryRenderItems, props.events, props.pendingApprovals]
  );

  const hasContent =
    data.approvals.length > 0 ||
    data.outputs.length > 0 ||
    data.tasks.length > 0 ||
    data.sources.length > 0;

  function toggleSection(section: string) {
    setExpandedSections((previous) => ({
      ...previous,
      [section]: !previous[section]
    }));
  }

  return (
    <div className="cn-summary-layer" onClick={props.onClose}>
      <section className="cn-summary-popover" onClick={(event) => event.stopPropagation()}>
        <header className="cn-summary-header">
          <div className="cn-summary-header-copy">
            <strong>摘要</strong>
          </div>
          <button className="cn-close-button" type="button" onClick={props.onClose} aria-label="关闭摘要">
            <CodexIcon name="x" />
          </button>
        </header>

        {data.approvals.length > 0 ? (
          <div className="cn-summary-section">
            <div className="cn-summary-section-title">
              <span>审批</span>
              <strong>{data.approvals.length}</strong>
            </div>
            <div className="cn-summary-approval-list">
              {data.approvals.slice(0, 2).map((approval) => {
                const summary = summarizeApproval(approval);
                return (
                  <article key={approval.approvalId} className="cn-summary-approval-card">
                    <div>
                      <strong>{summary.title}</strong>
                      <span>{summary.typeLabel}</span>
                    </div>
                    <div className="cn-summary-approval-actions">
                      <button
                        className="cn-soft-button"
                        type="button"
                        onClick={() => props.onDecision(approval.approvalId, "accept")}
                      >
                        允许
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
          </div>
        ) : null}

        <SummaryListSection
          count={data.outputs.length}
          expanded={Boolean(expandedSections.outputs)}
          icon="document"
          items={data.outputs}
          sectionKey="outputs"
          title="输出"
          onToggle={toggleSection}
        />

        <SummaryListSection
          count={data.tasks.length}
          expanded={Boolean(expandedSections.tasks)}
          icon="tasks"
          items={data.tasks}
          monospace
          sectionKey="tasks"
          title="任务"
          onToggle={toggleSection}
        />

        {data.sources.length > 0 ? (
          <div className="cn-summary-section">
            <div className="cn-summary-section-title">
              <span>来源</span>
              <strong>{data.sources.length}</strong>
            </div>
            <div className="cn-summary-source-list">
              {data.sources.map((source) => (
                <div key={source.key} className="cn-summary-source-pill" title={source.label}>
                  <CodexIcon name={source.icon} />
                  <span>{source.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!hasContent ? <div className="cn-summary-empty">当前没有可汇总内容</div> : null}
      </section>
    </div>
  );
}

function SummaryListSection(props: {
  count: number;
  expanded: boolean;
  icon: "document" | "tasks";
  items: SummaryOutputItem[] | SummaryTaskItem[];
  monospace?: boolean;
  sectionKey: string;
  title: string;
  onToggle: (section: string) => void;
}) {
  if (props.items.length === 0) {
    return null;
  }

  const visibleCount = props.expanded ? props.items.length : summaryVisibleRows();
  const visibleItems = props.items.slice(0, visibleCount);
  const hiddenCount = Math.max(0, props.items.length - visibleItems.length);

  return (
    <div className="cn-summary-section">
      <div className="cn-summary-section-title">
        <span>{props.title}</span>
        <strong>{props.count}</strong>
      </div>
      <div className="cn-summary-row-list">
        {visibleItems.map((item) => (
          <div key={item.key} className="cn-summary-row">
            <CodexIcon name={props.icon} />
            <div className="cn-summary-row-copy">
              <strong className={props.monospace ? "mono" : undefined}>{item.title}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button
          className="cn-summary-more-button"
          type="button"
          onClick={() => props.onToggle(props.sectionKey)}
        >
          {props.expanded ? "收起" : `再显示 ${hiddenCount} 个`}
        </button>
      ) : null}
    </div>
  );
}
