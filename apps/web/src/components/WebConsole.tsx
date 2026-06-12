"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { sessionTitle } from "../features/sessions/session-utils";
import type {
  ProjectThreadGroupData,
  ThreadListItem
} from "../features/sessions/session-utils";
import {
  modelOptions,
  permissionOptions,
  reasoningOptions,
  useWebConsoleController
} from "../features/console/use-web-console-controller";
import { ChatCanvas } from "./chat/ChatCanvas";
import { LiveComposer } from "./chat/LiveComposer";
import { NewSessionCanvas } from "./chat/NewSessionCanvas";
import { PinnedThreadSection, ProjectThreadGroup } from "./chat/ProjectThreadGroup";
import { CodexIcon } from "./DesignLab";
import { ApprovalModal } from "./sheets/ApprovalModal";
import { DeviceSheet } from "./sheets/DeviceSheet";
import { SummarySheet } from "./sheets/SummarySheet";
import { SessionSetupSheet } from "./sheets/SessionSetupSheet";

function matchesSidebarQuery(item: ThreadListItem, query: string): boolean {
  return (
    item.title.toLocaleLowerCase().includes(query) ||
    item.timeLabel.toLocaleLowerCase().includes(query)
  );
}

function filterProjectGroups(
  groups: ProjectThreadGroupData[],
  query: string
): ProjectThreadGroupData[] {
  if (!query) {
    return groups;
  }
  return groups
    .map((group) => {
      const projectMatches =
        group.name.toLocaleLowerCase().includes(query) ||
        group.cwd.toLocaleLowerCase().includes(query);
      if (projectMatches) {
        return group;
      }
      const items = group.items.filter((item) => matchesSidebarQuery(item, query));
      return items.length > 0 ? { ...group, items } : null;
    })
    .filter((group): group is ProjectThreadGroupData => Boolean(group));
}

function summarizeSidebarIssue(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "发生错误";
  }
  if (trimmed.includes("Failed to fetch") || trimmed.includes("NetworkError")) {
    return "网络请求失败";
  }
  if (
    trimmed.includes("Missing or invalid user token") ||
    trimmed.includes("登录会话已过期")
  ) {
    return "登录已过期";
  }
  if (trimmed.includes("原项目已不存在")) {
    return "原项目不存在";
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  return firstLine.length > 34 ? `${firstLine.slice(0, 31)}...` : firstLine;
}

export function WebConsole() {
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const {
    activeMenu,
    activeSheet,
    activeTurn,
    attachments,
    chatItems,
    clearThreadHoverPreview,
    closeActiveSheet,
    connection,
    connected,
    codexHistory,
    currentResumeState,
    currentSession,
    cwd,
    desktopFrameRef,
    desktopFrameStyle,
    deviceDisplayName,
    deviceName,
    devicePresence,
    directoryError,
    directoryList,
    directoryLoading,
    draft,
    error,
    events,
    fileInputRef,
    firstApproval,
    goalComposerMode,
    handleApprovalDecision,
    handleActivateGoalComposer,
    handleAttachFiles,
    handleClearGoal,
    handleConnect,
    handleDismissComposerGoal,
    dismissMigrationNotice,
    handleInterrupt,
    handleLoadDirectories,
    handleRemoveAttachment,
    handleTogglePlanMode,
    hasCurrentGoal,
    healthStatus,
    historyLoadingKey,
    migrationNotice,
    initialGoal,
    initialTokenBudget,
    model,
    openDeviceSheet,
    openSummarySheet,
    openNewSessionSetup,
    pendingApprovals,
    permissionMode,
    planModeEnabled,
    pinnedThreadItems,
    projectGroups,
    reasoningEffort,
    resetSidebarWidth,
    relayEnabled,
    relayConnectionInfo,
    refreshRelayDevices,
    togglePinnedProject,
    renameProject,
    archiveProject,
    removeProject,
    savedDevices,
    startProjectSession,
    selectCwd,
    selectHistory,
    selectSession,
    selectedDeviceId,
    selectedHistoryEntry,
    selectedModel,
    selectedPermission,
    selectedReasoning,
    sessionSidebarRef,
    setActiveMenu,
    setDraft,
    setInitialGoal,
    setInitialTokenBudget,
    setModel,
    setPermissionMode,
    setReasoningEffort,
    setSidebarCollapsed,
    showThreadHoverPreview,
    sidebarSyncing,
    sidebarCollapsed,
    sidebarResizing,
    startSidebarResize,
    streamStatus,
    submitComposer,
    threadHoverPreview,
    togglePinnedThread,
    archiveThread,
    deleteSavedDevice,
    canLoadOlderHistory,
    loadOlderHistory,
    loadingOlderHistory,
    visibleChatItems
  } = useWebConsoleController();
  const deferredSidebarQuery = useDeferredValue(sidebarQuery);
  const normalizedSidebarQuery = deferredSidebarQuery.trim().toLocaleLowerCase();
  const filteredPinnedThreadItems = useMemo(
    () =>
      normalizedSidebarQuery
        ? pinnedThreadItems.filter((item) => matchesSidebarQuery(item, normalizedSidebarQuery))
        : pinnedThreadItems,
    [normalizedSidebarQuery, pinnedThreadItems]
  );
  const filteredProjectGroups = useMemo(
    () => filterProjectGroups(projectGroups, normalizedSidebarQuery),
    [normalizedSidebarQuery, projectGroups]
  );
  const totalThreadCount =
    pinnedThreadItems.length +
    projectGroups.reduce((total, group) => total + group.items.length, 0);
  const sidebarIssueMessage = error
    ? summarizeSidebarIssue(error)
    : currentResumeState === "missing"
      ? "原项目不存在"
      : currentResumeState === "failed"
        ? "这条记录暂时打不开"
        : null;
  const sidebarStatusMessage = sidebarIssueMessage
    ? sidebarIssueMessage
    : !connected
      ? "先连接设备"
      : totalThreadCount > 0
        ? `已同步 ${projectGroups.length} 个项目 · ${totalThreadCount} 条会话`
        : "设备已连接";
  const showSidebarSkeleton =
    connected &&
    sidebarSyncing &&
    normalizedSidebarQuery.length === 0 &&
    filteredProjectGroups.length === 0 &&
    filteredPinnedThreadItems.length === 0;
  const sidebarEmptyMessage =
    normalizedSidebarQuery.length > 0
      ? "没有匹配的项目或会话"
      : connected
        ? "还没有对话"
        : "先连接设备";

  const headerTitle = selectedHistoryEntry
    ? selectedHistoryEntry.title
    : currentSession
      ? sessionTitle(currentSession, chatItems, codexHistory)
      : "新会话";

  return (
    <main className="cn-live-console">
      <div
        ref={desktopFrameRef}
        className={
          sidebarCollapsed
            ? sidebarResizing
              ? "cn-desktop-frame cn-app-frame sidebar-collapsed resizing"
              : "cn-desktop-frame cn-app-frame sidebar-collapsed"
            : sidebarResizing
              ? "cn-desktop-frame cn-app-frame resizing"
              : "cn-desktop-frame cn-app-frame"
        }
        style={desktopFrameStyle}
      >
        <nav className="cn-nav-rail" aria-label="CodexNext navigation">
          <div className="cn-mark">CN</div>
          {sidebarCollapsed ? (
            <button
              className="cn-rail-button"
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="展开会话栏"
            >
              <CodexIcon name="collapse" />
            </button>
          ) : null}
          <button
            className={connected ? "cn-rail-button active" : "cn-rail-button"}
            type="button"
            onClick={openDeviceSheet}
            aria-label="选择设备"
          >
            <CodexIcon name="terminal" />
            {connected ? <span className="cn-rail-dot" /> : null}
          </button>
          <button
            className="cn-rail-button"
            type="button"
            onClick={openNewSessionSetup}
            aria-label="新建对话"
          >
            <CodexIcon name="compose" />
          </button>
          <button
            className="cn-rail-button muted"
            type="button"
            onClick={openSummarySheet}
            aria-label="打开摘要"
          >
            <CodexIcon name="summary" />
          </button>
        </nav>

        <aside ref={sessionSidebarRef} className="cn-session-sidebar cn-live-sidebar">
          <div className="cn-sidebar-fixed">
            <div className="cn-sidebar-windowbar" aria-label="窗口导航">
              <span className="cn-window-dot red" />
              <span className="cn-window-dot yellow" />
              <span className="cn-window-dot green" />
              <button type="button" aria-label="折叠会话栏" onClick={() => setSidebarCollapsed(true)}>
                <CodexIcon name="collapse" />
              </button>
              <button type="button" aria-label="后退" onClick={() => window.history.back()}>
                <CodexIcon name="back" />
              </button>
              <button type="button" aria-label="前进" onClick={() => window.history.forward()}>
                <CodexIcon name="forward" />
              </button>
            </div>

            <div className="cn-sidebar-brand">
              <strong>CodexNext</strong>
            </div>

            <button className="cn-device-summary" type="button" onClick={openDeviceSheet}>
              <CodexIcon name="terminal" className="cn-device-icon" />
              <span className={connected ? "cn-live-dot" : "cn-live-dot offline"} />
              <span className="cn-device-copy compact">
                <strong>{deviceDisplayName}</strong>
              </span>
            </button>
          </div>

          <div className="cn-project-tree">
            <div className="cn-sidebar-search" role="search">
              <CodexIcon name="search" />
              <input
                type="search"
                value={sidebarQuery}
                onChange={(event) => setSidebarQuery(event.target.value)}
                placeholder="搜索项目或会话"
                aria-label="搜索项目或会话"
              />
              {sidebarQuery.trim().length > 0 ? (
                <button
                  className="cn-sidebar-search-clear"
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => setSidebarQuery("")}
                >
                  <CodexIcon name="x" />
                </button>
              ) : null}
            </div>
            <div
              className={sidebarIssueMessage ? "cn-sidebar-status error" : "cn-sidebar-status"}
              role="status"
              aria-live="polite"
            >
              <span
                className={
                  sidebarIssueMessage
                    ? "cn-sidebar-status-dot error"
                    : sidebarSyncing
                    ? "cn-sidebar-status-dot syncing"
                    : connected
                      ? "cn-sidebar-status-dot ready"
                      : "cn-sidebar-status-dot offline"
                }
              />
              <span>{sidebarStatusMessage}</span>
            </div>
            <PinnedThreadSection
              items={filteredPinnedThreadItems}
              historyLoadingKey={historyLoadingKey}
              onArchiveThread={archiveThread}
              onHideThreadPreview={clearThreadHoverPreview}
              onShowThreadPreview={showThreadHoverPreview}
              onTogglePinnedThread={togglePinnedThread}
              onSelectHistory={(entry) => void selectHistory(entry)}
              onSelectSession={selectSession}
            />
            <button
              className="cn-project-tree-toggle"
              type="button"
              onClick={() => setProjectsCollapsed((value) => !value)}
            >
              <span>项目</span>
              <CodexIcon name={projectsCollapsed ? "chevronRight" : "chevronDown"} />
            </button>
            {projectsCollapsed ? null : (
              <div className="cn-project-scroll" onScroll={clearThreadHoverPreview}>
                {showSidebarSkeleton ? (
                  <div className="cn-sidebar-skeleton" aria-hidden="true">
                    <span className="cn-sidebar-skeleton-line wide" />
                    <span className="cn-sidebar-skeleton-line" />
                    <span className="cn-sidebar-skeleton-line medium" />
                    <span className="cn-sidebar-skeleton-line wide" />
                    <span className="cn-sidebar-skeleton-line short" />
                  </div>
                ) : null}
                {filteredProjectGroups.map((group) => (
                  <ProjectThreadGroup
                    key={group.cwd}
                    group={group}
                    historyLoadingKey={historyLoadingKey}
                    onArchiveThread={archiveThread}
                    onArchiveProject={archiveProject}
                    onHideThreadPreview={clearThreadHoverPreview}
                    onRemoveProject={removeProject}
                    onRenameProject={renameProject}
                    onShowThreadPreview={showThreadHoverPreview}
                    onStartProjectSession={startProjectSession}
                    onTogglePinnedProject={togglePinnedProject}
                    onTogglePinnedThread={togglePinnedThread}
                    onSelectHistory={(entry) => void selectHistory(entry)}
                    onSelectSession={selectSession}
                  />
                ))}
                {filteredProjectGroups.length === 0 &&
                filteredPinnedThreadItems.length === 0 &&
                !showSidebarSkeleton ? (
                  <div className="cn-empty-sidebar">
                    {sidebarEmptyMessage}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="cn-sidebar-footer">
            <button
              className="cn-settings-button"
              type="button"
              onClick={openDeviceSheet}
              aria-label="设置"
            >
              <span>
                <CodexIcon name="settings" />
                设置
              </span>
              <CodexIcon name="phone" />
            </button>
          </div>

          <div
            className={sidebarResizing ? "cn-sidebar-resize-handle dragging" : "cn-sidebar-resize-handle"}
            role="separator"
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            onDoubleClick={resetSidebarWidth}
            onPointerDown={startSidebarResize}
          />
        </aside>

        {threadHoverPreview ? (
          <div
            className="cn-thread-hover-card"
            style={
              {
                left: `${threadHoverPreview.left}px`,
                maxWidth: `${threadHoverPreview.maxWidth}px`,
                top: `${threadHoverPreview.top}px`
              } as CSSProperties
            }
          >
            {threadHoverPreview.title}
          </div>
        ) : null}

        <section className={currentSession ? "cn-main thread cn-live-main" : "cn-main cn-live-main"}>
          <header className="cn-main-header cn-live-header">
            <button
              className="cn-mobile-menu-button"
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="显示目录"
            >
              <CodexIcon name="collapse" />
            </button>
            <div>
              <h1>{headerTitle}</h1>
            </div>
            <div className="cn-live-header-actions">
              <button
                className="cn-summary-button"
                type="button"
                aria-label="打开摘要"
                onClick={openSummarySheet}
              >
                <CodexIcon name="summary" />
              </button>
            </div>
          </header>

          {currentSession ? (
            <ChatCanvas
              active={activeTurn}
              canLoadOlderHistory={canLoadOlderHistory}
              items={visibleChatItems}
              loadingOlderHistory={loadingOlderHistory}
              onLoadOlderHistory={() => void loadOlderHistory()}
              pendingApprovals={pendingApprovals.length}
              session={currentSession}
              onOpenSummary={openSummarySheet}
            />
          ) : (
            <NewSessionCanvas
              connected={connected}
              cwd={cwd}
              deviceName={deviceDisplayName}
              modelLabel={selectedModel.label}
              permissionLabel={selectedPermission.label}
              pinnedCount={pinnedThreadItems.length}
              projectCount={projectGroups.length}
              threadCount={totalThreadCount}
              onOpenSetup={openNewSessionSetup}
            />
          )}

          <LiveComposer
            activeMenu={activeMenu}
            activeTurn={activeTurn}
            attachments={attachments}
            draft={draft}
            fileInputRef={fileInputRef}
            goalMode={goalComposerMode}
            hasGoal={hasCurrentGoal}
            modelOptions={modelOptions}
            permissionMode={permissionMode}
            permissionOptions={permissionOptions}
            planMode={planModeEnabled}
            reasoningEffort={reasoningEffort}
            reasoningOptions={reasoningOptions}
            selectedModel={selectedModel}
            selectedPermission={selectedPermission}
            selectedReasoning={selectedReasoning}
            onActivateGoalMode={handleActivateGoalComposer}
            onAttachFiles={(files) => void handleAttachFiles(files)}
            onClearGoal={() => void handleClearGoal()}
            onCloseMenu={() => setActiveMenu(null)}
            onDismissGoalMode={handleDismissComposerGoal}
            onDraftChange={setDraft}
            onInterrupt={() => void handleInterrupt()}
            onOpenMenu={(menu) => setActiveMenu(activeMenu === menu ? null : menu)}
            onRemoveAttachment={handleRemoveAttachment}
            onSelectModel={setModel}
            onSelectPermission={setPermissionMode}
            onSelectReasoning={setReasoningEffort}
            onSubmit={() => void submitComposer()}
            onTogglePlanMode={handleTogglePlanMode}
          />
        </section>

        {activeSheet === "device" ? (
          <DeviceSheet
            connected={connected}
            connection={connection}
            devicePresence={devicePresence}
            deviceName={deviceName}
            healthStatus={healthStatus}
            migrationNotice={migrationNotice}
            relayConnectionInfo={relayConnectionInfo}
            savedDevices={savedDevices}
            selectedDeviceId={selectedDeviceId}
            streamStatus={streamStatus}
            onClose={closeActiveSheet}
            onConnect={handleConnect}
            onDeleteDevice={deleteSavedDevice}
            onDismissMigrationNotice={dismissMigrationNotice}
            onRefreshRelayDevices={refreshRelayDevices}
          />
        ) : null}

        {activeSheet === "session" ? (
          <SessionSetupSheet
            connected={connected}
            cwd={cwd}
            deviceName={deviceDisplayName}
            directoryError={directoryError}
            directoryList={directoryList}
            directoryLoading={directoryLoading}
            initialGoal={initialGoal}
            initialTokenBudget={initialTokenBudget}
            model={model}
            modelOptions={modelOptions}
            permissionMode={permissionMode}
            permissionOptions={permissionOptions}
            reasoningEffort={reasoningEffort}
            reasoningOptions={reasoningOptions}
            streamStatus={streamStatus}
            onClose={closeActiveSheet}
            onInitialGoalChange={setInitialGoal}
            onInitialTokenBudgetChange={setInitialTokenBudget}
            onLoadDirectories={(path) => void handleLoadDirectories(path)}
            onOpenDevice={openDeviceSheet}
            onSelectCwd={selectCwd}
            onSelectModel={setModel}
            onSelectPermission={setPermissionMode}
            onSelectReasoning={setReasoningEffort}
          />
        ) : null}

        {activeSheet === "summary" ? (
          <SummarySheet
            chatItems={visibleChatItems}
            events={
              currentSession
                ? events.filter((event) => event.sessionId === currentSession.sessionId)
                : []
            }
            pendingApprovals={
              currentSession
                ? pendingApprovals.filter(
                    (approval) => approval.sessionId === currentSession.sessionId
                  )
                : pendingApprovals
            }
            onClose={closeActiveSheet}
            onDecision={(approvalId, decision) => void handleApprovalDecision(approvalId, decision)}
          />
        ) : null}

        {firstApproval ? (
          <ApprovalModal
            approval={firstApproval}
            onDecision={(decision) =>
              void handleApprovalDecision(firstApproval.approvalId, decision)
            }
          />
        ) : null}
      </div>
    </main>
  );
}
