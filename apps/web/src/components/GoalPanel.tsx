import { useEffect, useState } from "react";
import type { ThreadGoal } from "@codexnext/protocol";

export function GoalPanel(props: {
  goal: ThreadGoal | null;
  disabled: boolean;
  onSet: (input: {
    objective?: string | null;
    status?: string | null;
    tokenBudget?: number | null;
  }) => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const [objective, setObjective] = useState("");
  const [tokenBudget, setTokenBudget] = useState("");

  useEffect(() => {
    if (props.goal?.objective) {
      setObjective(props.goal.objective);
    }
    if (props.goal?.tokenBudget) {
      setTokenBudget(String(props.goal.tokenBudget));
    }
  }, [props.goal]);

  return (
    <section className="inspector-panel">
      <div className="section-heading">
        <span>Goal</span>
        <button
          className="ghost-button"
          type="button"
          onClick={props.onRefresh}
          disabled={props.disabled}
        >
          Refresh
        </button>
      </div>

      <div className={props.goal ? "goal-summary active" : "goal-summary"}>
        <strong>{props.goal?.objective ?? "暂无 Goal"}</strong>
        {props.goal ? <div className="meta">{props.goal.status}</div> : null}
      </div>

      <div className="stack">
        <label>
          Objective
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="目标"
            disabled={props.disabled}
          />
        </label>
        <label>
          Token Budget
          <input
            inputMode="numeric"
            value={tokenBudget}
            onChange={(event) => setTokenBudget(event.target.value)}
            placeholder="可选"
            disabled={props.disabled}
          />
        </label>
        <div className="row compact">
          <button
            type="button"
            disabled={props.disabled || !objective.trim()}
            onClick={() =>
              props.onSet({
                objective: objective.trim(),
                status: "active",
                tokenBudget: tokenBudget ? Number(tokenBudget) : null
              })
            }
          >
            Set
          </button>
          <button
            className="secondary"
            type="button"
            disabled={props.disabled || !props.goal}
            onClick={() => props.onSet({ status: "paused" })}
          >
            Pause
          </button>
          <button
            className="secondary"
            type="button"
            disabled={props.disabled || !props.goal}
            onClick={() => props.onSet({ status: "active" })}
          >
            Resume
          </button>
          <button
            className="danger"
            type="button"
            disabled={props.disabled || !props.goal}
            onClick={props.onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}
