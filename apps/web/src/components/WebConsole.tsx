"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { sessionTitleFromTurnGroups } from "../features/sessions/session-utils";
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
import {
  formatMissingHistoryFolderMessage,
  formatMissingHistoryFolderShortMessage
} from "../features/console/console-utils";
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
  if (
    trimmed.includes("这个文件夹不存在") ||
    trimmed.includes("文件夹不存在") ||
    trimmed.includes("cwd does not exist:")
  ) {
    return "文件夹不存在";
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  return firstLine.length > 34 ? `${firstLine.slice(0, 31)}...` : firstLine;
}

type MobileConsoleScreen = "directory" | "chat";

const mobileScreenStorageKey = "codexnext.mobileScreen.v1";

function isMobileConsoleViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
}

function readMobileScreenPreference(): MobileConsoleScreen | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.sessionStorage.getItem(mobileScreenStorageKey);
    return value === "chat" || value === "directory" ? value : null;
  } catch {
    return null;
  }
}

function writeMobileScreenPreference(screen: MobileConsoleScreen): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(mobileScreenStorageKey, screen);
  } catch {
    // Session storage is a best-effort guard for dev remounts.
  }
}

export function WebConsole() {
  const [mobileScreen, setMobileScreen] = useState<MobileConsoleScreen>("directory");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const restoredMobileSessionRef = useRef<string | null>(null);
  const mobileScreenTouchedRef = useRef(false);
  const {
    activeMenu,
    activeSheet,
    activeTurn,
    attachments,
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
    clearServiceTier,
    handleConnect,
    handleDismissComposerGoal,
    dismissMigrationNotice,
    handleInterrupt,
    handleLoadDirectories,
    handleRemoveAttachment,
    handleQueuedMessageDelete,
    handleQueuedMessageEdit,
    handleQueuedMessageReorder,
    handleQueuedMessageSteer,
    handleQueuedMessagesClear,
    handleTogglePlanMode,
    hasCurrentGoal,
    healthStatus,
    historyLoadingKey,
    migrationNotice,
    initialHistoryLoading,
    initialGoal,
    initialTokenBudget,
    model,
    openDeviceSheet,
    openSummarySheet,
    openNewSessionSetup,
    startNewSessionDraft,
    pendingApprovals,
    permissionMode,
    planModeEnabled,
    pinnedThreadItems,
    projectGroups,
    reasoningEffort,
    resetSidebarWidth,
    runSlashCommand,
    relayEnabled,
    relayConnectionInfo,
    refreshRelayDevices,
    togglePinnedProject,
    renameProject,
    archiveProject,
    removeProject,
    savedDevices,
    serviceTier,
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
    visibleChatItems,
    visibleTurnGroups
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
      ? "文件夹不存在"
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
      ? sessionTitleFromTurnGroups(
          currentSession,
          visibleTurnGroups,
          codexHistory
        )
      : "新会话";
  const missingHistoryCwd =
    currentResumeState === "missing"
      ? selectedHistoryEntry?.cwd ?? currentSession?.cwd ?? cwd
      : null;
  const missingHistoryNotice = missingHistoryCwd
    ? {
        title: "无法继续这个对话",
        body: formatMissingHistoryFolderShortMessage(missingHistoryCwd)
      }
    : null;
  const composerDisabledReason = missingHistoryCwd
    ? formatMissingHistoryFolderMessage(missingHistoryCwd)
    : null;
  const frameClassName = [
    "cn-desktop-frame",
    "cn-app-frame",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    sidebarResizing ? "resizing" : "",
    `mobile-screen-${mobileScreen}`,
    mobileSearchOpen || sidebarQuery.trim().length > 0 ? "mobile-search-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const preference = readMobileScreenPreference();
    if (preference) {
      setMobileScreen(preference);
    }
  }, []);

  useEffect(() => {
    if (currentSession && restoredMobileSessionRef.current === null) {
      restoredMobileSessionRef.current = currentSession.sessionId;
      if (!mobileScreenTouchedRef.current && readMobileScreenPreference() === "chat") {
        setMobileScreen("chat");
      }
    }
  }, [currentSession?.sessionId]);

  function showMobileChat() {
    mobileScreenTouchedRef.current = true;
    writeMobileScreenPreference("chat");
    setMobileScreen("chat");
    if (isMobileConsoleViewport()) {
      setMobileSearchOpen(false);
      setSidebarQuery("");
      setSidebarCollapsed(true);
    }
  }

  function showMobileDirectory() {
    mobileScreenTouchedRef.current = true;
    writeMobileScreenPreference("directory");
    clearThreadHoverPreview();
    setMobileScreen("directory");
    if (isMobileConsoleViewport()) {
      setMobileSearchOpen(false);
      setSidebarQuery("");
      setSidebarCollapsed(false);
    }
  }

  function handleSelectHistory(entry: Parameters<typeof selectHistory>[0]) {
    showMobileChat();
    void selectHistory(entry);
  }

  function handleSelectSession(sessionId: string) {
    showMobileChat();
    selectSession(sessionId);
  }

  function handleStartProjectSession(projectCwd: string) {
    showMobileChat();
    startProjectSession(projectCwd);
  }

  function handleStartNewSessionDraft() {
    showMobileChat();
    startNewSessionDraft();
  }

  function openMobileSearch() {
    setMobileSearchOpen(true);
    window.setTimeout(() => sidebarSearchInputRef.current?.focus(), 0);
  }

  function handleCollapseSidebar() {
    if (isMobileConsoleViewport()) {
      if (currentSession) {
        showMobileChat();
      }
      return;
    }
    setSidebarCollapsed(true);
  }

  return (
    <main className="cn-live-console">
      <div
        ref={desktopFrameRef}
        className={frameClassName}
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
            onClick={handleStartNewSessionDraft}
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
              <button type="button" aria-label="折叠会话栏" onClick={handleCollapseSidebar}>
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
            <button
              className="cn-mobile-directory-search cn-rail-button"
              type="button"
              onClick={openMobileSearch}
              aria-label="搜索会话"
              title="搜索会话"
            >
              <CodexIcon name="search" />
            </button>
            <button
              className="cn-mobile-directory-action cn-rail-button"
              type="button"
              onClick={handleStartNewSessionDraft}
              aria-label="新建对话"
              title="新建对话"
            >
              <CodexIcon name="compose" />
            </button>
          </div>

          <div className="cn-project-tree">
            <div className="cn-sidebar-search" role="search">
              <CodexIcon name="search" />
              <input
                ref={sidebarSearchInputRef}
                type="search"
                value={sidebarQuery}
                onChange={(event) => {
                  setSidebarQuery(event.target.value);
                  if (event.target.value.trim().length > 0) {
                    setMobileSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  if (sidebarQuery.trim().length === 0) {
                    setMobileSearchOpen(false);
                  }
                }}
                placeholder="搜索项目或会话"
                aria-label="搜索项目或会话"
              />
              {sidebarQuery.trim().length > 0 ? (
                <button
                  className="cn-sidebar-search-clear"
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => {
                    setSidebarQuery("");
                    setMobileSearchOpen(false);
                  }}
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
              onSelectHistory={handleSelectHistory}
              onSelectSession={handleSelectSession}
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
                    onStartProjectSession={handleStartProjectSession}
                    onTogglePinnedProject={togglePinnedProject}
                    onTogglePinnedThread={togglePinnedThread}
                    onSelectHistory={handleSelectHistory}
                    onSelectSession={handleSelectSession}
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
              onClick={showMobileDirectory}
              aria-label="返回目录"
            >
              <CodexIcon name="back" />
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
              blockedNotice={missingHistoryNotice}
              items={visibleChatItems}
              turnGroups={visibleTurnGroups}
              loadingInitialHistory={initialHistoryLoading}
              pendingApprovals={pendingApprovals.length}
              session={currentSession}
              threadSubtitle={selectedHistoryEntry?.cwd ?? currentSession.cwd}
              threadTitle={headerTitle}
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
            queuedMessages={currentSession?.queuedMessages ?? []}
            reasoningEffort={reasoningEffort}
            reasoningOptions={reasoningOptions}
            selectedModel={selectedModel}
            selectedPermission={selectedPermission}
            selectedReasoning={selectedReasoning}
            serviceTier={serviceTier}
            onActivateGoalMode={handleActivateGoalComposer}
            onAttachFiles={(files) => void handleAttachFiles(files)}
            onClearGoal={() => void handleClearGoal()}
            onClearServiceTier={clearServiceTier}
            onCloseMenu={() => setActiveMenu(null)}
            onDismissGoalMode={handleDismissComposerGoal}
            onDraftChange={setDraft}
            onInterrupt={() => void handleInterrupt()}
            onOpenMenu={(menu) => setActiveMenu(activeMenu === menu ? null : menu)}
            onQueuedMessageDelete={handleQueuedMessageDelete}
            onQueuedMessageEdit={handleQueuedMessageEdit}
            onQueuedMessageReorder={handleQueuedMessageReorder}
            onQueuedMessageSteer={handleQueuedMessageSteer}
            onQueuedMessagesClear={handleQueuedMessagesClear}
            onRemoveAttachment={handleRemoveAttachment}
            onSelectModel={setModel}
            onSelectPermission={setPermissionMode}
            onSelectReasoning={setReasoningEffort}
            onRunSlashCommand={runSlashCommand}
            onSubmit={() => void submitComposer()}
            onSubmitGuide={() => void submitComposer("steer")}
            onTogglePlanMode={handleTogglePlanMode}
            disabledReason={composerDisabledReason}
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
            turnGroups={visibleTurnGroups}
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
