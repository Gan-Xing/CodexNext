import type { ChatRenderItem } from "../../features/chat/turn-rendering";

export function PlanBlock(props: {
  item: ChatRenderItem;
}) {
  const payload = props.item.meta?.payload;
  const parsed = parsePlanPayload(payload);

  if (!parsed) {
    return (
      <section className="cn-semantic-block cn-plan-block">
        <header className="cn-semantic-header">
          <strong>Plan updated</strong>
        </header>
        <pre>{props.item.text}</pre>
      </section>
    );
  }

  return (
    <section className="cn-semantic-block cn-plan-block">
      <header className="cn-semantic-header">
        <strong>Plan updated</strong>
      </header>
      {parsed.explanation ? (
        <p className="cn-plan-explanation">{parsed.explanation}</p>
      ) : null}
      <div className="cn-plan-list">
        {parsed.plan.map((step, index) => (
          <div key={`${index}-${step.step}`} className="cn-plan-step">
            <span className={`cn-plan-status ${step.status ?? "pending"}`}>
              {step.status ?? "pending"}
            </span>
            <span>{step.step ?? "Untitled step"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function parsePlanPayload(payload: unknown): {
  explanation?: string;
  plan: Array<{ step?: string; status?: string }>;
} | null {
  if (!isRecord(payload) || !Array.isArray(payload.plan)) {
    return null;
  }
  return {
    ...(typeof payload.explanation === "string"
      ? { explanation: payload.explanation }
      : {}),
    plan: payload.plan.map((item) =>
      isRecord(item)
        ? {
            ...(typeof item.step === "string" ? { step: item.step } : {}),
            ...(typeof item.status === "string" ? { status: item.status } : {})
          }
        : {}
    )
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
