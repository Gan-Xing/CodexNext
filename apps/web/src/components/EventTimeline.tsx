import type { LocalEvent } from "../lib/types";

export function EventTimeline(props: { events: LocalEvent[] }) {
  return (
    <section className="inspector-panel">
      <div className="section-heading">
        <span>Activity</span>
        <span className="count-badge">{props.events.length}</span>
      </div>
      <div className="timeline">
        {props.events
          .slice()
          .reverse()
          .slice(0, 80)
          .map((event) => (
            <details key={event.seq} className="event-row">
              <summary>
                <span>#{event.seq}</span>
                <strong>{event.type}</strong>
              </summary>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </details>
          ))}
      </div>
    </section>
  );
}
