interface NewSessionCanvasProps {
  cwd: string;
  deviceName: string;
  modelLabel: string;
  permissionLabel: string;
  onOpenSetup: () => void;
}

function shortCwdLabel(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) {
    return "还没有选择工作目录";
  }
  const parts = trimmed.split("/").filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

export function NewSessionCanvas(props: NewSessionCanvasProps) {
  const hasCwd = props.cwd.trim().length > 0;

  return (
    <section className="cn-empty-canvas cn-live-empty">
      <div className="cn-empty-copy">
        <h2>新对话</h2>
        <p>
          {hasCwd
            ? "直接在下方输入就会从当前项目开始。需要切换目录、模型或权限模式时，再打开设置。"
            : "先选一个工作目录，再从下方输入消息开始。这样新会话会落在正确的项目里。"}
        </p>
      </div>
      <div className="cn-flow-card cn-new-session-guide">
        <strong>{hasCwd ? "已经准备好开始" : "还差一步设置目录"}</strong>
        <span>
          {hasCwd
            ? `当前设备是 ${props.deviceName}，会话会在 ${props.cwd} 中启动。`
            : `当前设备是 ${props.deviceName}，但还没有选中工作目录。`}
        </span>
        <div className="cn-new-session-guide-meta">
          <div className="cn-new-session-guide-pill" title={props.deviceName}>
            <b>设备</b>
            <span>{props.deviceName}</span>
          </div>
          <div className="cn-new-session-guide-pill" title={props.cwd || "未选择"}>
            <b>目录</b>
            <span>{shortCwdLabel(props.cwd)}</span>
          </div>
          <div className="cn-new-session-guide-pill" title={props.modelLabel}>
            <b>模型</b>
            <span>{props.modelLabel}</span>
          </div>
          <div className="cn-new-session-guide-pill" title={props.permissionLabel}>
            <b>权限</b>
            <span>{props.permissionLabel}</span>
          </div>
        </div>
        <div className="cn-new-session-guide-actions">
          <button className="cn-primary-button" type="button" onClick={props.onOpenSetup}>
            {hasCwd ? "调整设置" : "选择文件夹"}
          </button>
        </div>
      </div>
    </section>
  );
}
