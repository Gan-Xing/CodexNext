import type { LocalSessionSummary } from "../../lib/types";
import { CodexIcon } from "../DesignLab";

export function GoalSheet(props: {
  currentSession: LocalSessionSummary | null;
  objective: string;
  tokenBudget: string;
  onClear: () => void;
  onClose: () => void;
  onObjectiveChange: (value: string) => void;
  onPause: () => void;
  onRefresh: () => void;
  onResume: () => void;
  onSet: () => void;
  onTokenBudgetChange: (value: string) => void;
}) {
  return (
    <div className="cn-overlay-panel cn-live-overlay right">
      <section className="cn-goal-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>Goal</h2>
        {props.currentSession?.goal ? <p>{props.currentSession.goal.status}</p> : null}
        <label>
          Objective
          <textarea
            name="goal_objective"
            value={props.objective}
            onChange={(event) => props.onObjectiveChange(event.target.value)}
            placeholder="目标"
          />
        </label>
        <label>
          Token Budget
          <input
            inputMode="numeric"
            name="goal_token_budget"
            value={props.tokenBudget}
            onChange={(event) => props.onTokenBudgetChange(event.target.value)}
            placeholder="可选"
          />
        </label>
        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button" onClick={props.onSet}>
            Set
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onPause}>
            Pause
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onResume}>
            Resume
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          <button className="cn-soft-button danger" type="button" onClick={props.onClear}>
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}
