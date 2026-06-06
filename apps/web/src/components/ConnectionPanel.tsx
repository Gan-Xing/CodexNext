import type { LocalHealthResponse, LocalSessionSummary } from "../lib/types";

export function ConnectionPanel(props: {
  agentUrl: string;
  token: string;
  healthStatus: LocalHealthResponse | null;
  streamStatus: string;
  deviceName: string;
  sessions: LocalSessionSummary[];
  currentSessionId: string | null;
  onAgentUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onDeviceNameChange: (value: string) => void;
  onConnect: () => void;
  deviceSetupOpen: boolean;
  onOpenDeviceSetup: () => void;
  onCloseDeviceSetup: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const online = props.healthStatus?.ok && props.streamStatus === "connected";
  const deviceKind = platformLabel(props.healthStatus?.device?.platform);

  return (
    <aside className="device-rail">
      <div className="brand-lockup">
        <div className="brand-mark">CN</div>
        <div>
          <strong>CodexNext</strong>
          <span>Your personal Codex control plane.</span>
        </div>
      </div>

      <section className={online ? "device-card online" : "device-card"}>
        <div className="device-card-top">
          <div>
            <p className="eyebrow">Codex Agent</p>
            <h2>{props.deviceName}</h2>
          </div>
          <span className={online ? "live-dot live" : "live-dot"} />
        </div>
        <div className="device-meta">
          <span>{props.healthStatus?.codex?.version ?? "Codex unknown"}</span>
          <span>{statusLabel(props.streamStatus)}</span>
        </div>
        <button type="button" onClick={props.onOpenDeviceSetup}>
          {online ? "设备" : "连接设备"}
        </button>
      </section>

      <details className="connection-settings">
        <summary>Connection settings</summary>
        <label>
          Agent URL
          <input
            value={props.agentUrl}
            onChange={(event) => props.onAgentUrlChange(event.target.value)}
          />
        </label>
        <label>
          Token
          <input
            value={props.token}
            onChange={(event) => props.onTokenChange(event.target.value)}
          />
        </label>
      </details>

      <section className="session-list">
        <div className="section-heading">
          <span>Sessions</span>
          <button className="ghost-button" type="button" onClick={props.onNewSession}>
            New
          </button>
        </div>
        {props.sessions.length === 0 ? (
          <div className="empty-small">No local sessions yet.</div>
        ) : (
          props.sessions.map((session) => (
            <button
              key={session.sessionId}
              className={
                props.currentSessionId === session.sessionId
                  ? "session-row selected"
                  : "session-row"
              }
              type="button"
              onClick={() => props.onSelectSession(session.sessionId)}
            >
              <span>{shortPath(session.cwd)}</span>
              <small>{session.status}</small>
            </button>
          ))
        )}
      </section>

      {props.deviceSetupOpen ? (
        <div className="device-modal-backdrop" role="presentation">
          <section className="device-modal" role="dialog" aria-label="Add local device">
            <div className="device-modal-header">
              <div>
                <p className="eyebrow">Device</p>
                <h2>连接 Codex Agent</h2>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={props.onCloseDeviceSetup}
              >
                Close
              </button>
            </div>

            <div className={online ? "device-hero online" : "device-hero"}>
              <div className="device-illustration">{deviceKind}</div>
              <div>
                <h3>{props.deviceName}</h3>
                <div className="meta">
                  {online ? "在线 online" : "等待连接 not connected"}
                </div>
                <div className="meta">
                  {props.healthStatus?.device?.hostname
                    ? `host ${props.healthStatus.device.hostname}`
                    : "host unknown"}
                </div>
              </div>
              <span className={online ? "live-dot live" : "live-dot"} />
            </div>

            <div className="device-modal-grid">
              <label>
                Device Name
                <input
                  value={props.deviceName}
                  onChange={(event) => props.onDeviceNameChange(event.target.value)}
                  placeholder="MacBook Pro / build server / office Mac mini"
                />
              </label>
              <label>
                Agent URL
                <input
                  value={props.agentUrl}
                  onChange={(event) => props.onAgentUrlChange(event.target.value)}
                />
              </label>
              <label>
                Access Token
                <input
                  value={props.token}
                  onChange={(event) => props.onTokenChange(event.target.value)}
                />
              </label>
            </div>

            <div className="device-help">
              <strong>设备名代表你要控制的 Codex Agent，不是当前浏览器。</strong>
              <span>
                手机 Web、Mac Web 或服务器 Web 都可以用这个名字识别连接目标；后续 QR
                pairing 会复用这套设备模型。
              </span>
            </div>

            <div className="device-modal-actions">
              <button className="secondary" type="button" onClick={props.onCloseDeviceSetup}>
                Later
              </button>
              <button type="button" onClick={props.onConnect}>
                {online ? "Reconnect 重连" : "Connect 连接"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function platformLabel(platform: string | undefined): string {
  if (platform === "darwin") {
    return "Mac";
  }
  if (platform === "linux") {
    return "Linux";
  }
  if (platform === "win32") {
    return "Win";
  }
  return "Agent";
}

function statusLabel(status: string): string {
  if (status === "connected") {
    return "在线 online";
  }
  if (status === "reconnecting") {
    return "reconnecting";
  }
  if (status === "error") {
    return "connection error";
  }
  if (status === "connecting") {
    return "connecting...";
  }
  return "not connected";
}
