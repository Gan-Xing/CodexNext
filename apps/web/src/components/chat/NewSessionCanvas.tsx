interface NewSessionCanvasProps {
  connected: boolean;
  cwd: string;
  deviceName: string;
  modelLabel: string;
  permissionLabel: string;
  pinnedCount: number;
  projectCount: number;
  threadCount: number;
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
  const projectSummary =
    props.projectCount > 0
      ? `已恢复 ${props.projectCount} 个项目 · ${props.threadCount} 条会话`
      : "连接完成后，会话列表会出现在侧栏";
  const heroTitle = !props.connected
    ? "先连上设备，再开始这一轮工作"
    : hasCwd
      ? `从 ${shortCwdLabel(props.cwd)} 开始下一条指令`
      : "先选一个目录，再让 CodexNext 真正开始工作";

  return (
    <section className="cn-empty-canvas cn-live-empty">
      <div className="cn-empty-copy">
        <span className="cn-empty-eyebrow">
          {!props.connected
            ? "等待设备接入"
            : "控制台已接入"}
        </span>
        <h2>{heroTitle}</h2>
        <p>
          {!props.connected
            ? "先把 relay 设备接入进来，侧栏和工作区才会开始同步。接入成功后，再决定目录、模型和权限。"
            : hasCwd
              ? "直接在下方输入就会从当前项目开始。要切换目录、模型或权限模式，再打开设置，不需要先离开这个页面。"
              : "目录决定了新会话会落在哪个项目里。先把目录定下来，下面的输入框才真正有上下文。"}
        </p>
        <div className="cn-empty-stats" aria-label="当前控制台上下文">
          <div className="cn-empty-stat">
            <b>项目</b>
            <strong>{props.projectCount}</strong>
          </div>
          <div className="cn-empty-stat">
            <b>会话</b>
            <strong>{props.threadCount}</strong>
          </div>
          <div className="cn-empty-stat">
            <b>置顶</b>
            <strong>{props.pinnedCount}</strong>
          </div>
        </div>
      </div>
      <div className="cn-empty-grid">
        <div className="cn-flow-card cn-new-session-guide">
          <strong>
            {hasCwd ? "已经准备好开始" : "还差一步设置目录"}
          </strong>
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
            <span className="cn-new-session-guide-hint">{projectSummary}</span>
          </div>
        </div>
        <div className="cn-flow-card cn-new-session-playbook">
          <strong>建议从这里开始</strong>
          <div className="cn-new-session-playbook-list">
            <div className="cn-new-session-playbook-item">
              <b>1</b>
              <span>先在下面直接输入目标，不需要先写一大段上下文。</span>
            </div>
            <div className="cn-new-session-playbook-item">
              <b>2</b>
              <span>如果目录不对，再打开设置切换；别先开一个“错项目”的会话。</span>
            </div>
            <div className="cn-new-session-playbook-item">
              <b>3</b>
              <span>常用线程就置顶，后面切回来会更像官方 Codex 的工作流。</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
