import { describe, expect, it } from "vitest";
import {
  ApprovalRequestParamsSchema,
  ApprovalResponseSchema,
  AppServerNotificationSchema,
  CodexNotificationMethod,
  CodexThreadSchema,
  CodexThreadItemType,
  CodexThreadTurnSchema,
  CommandExecutionRequestApprovalParamsSchema,
  CommandExecutionRequestApprovalResponseSchema,
  DeviceEventPayloadSchema,
  DevicePresenceSchema,
  FileChangeRequestApprovalParamsSchema,
  FileChangeRequestApprovalResponseSchema,
  InitializeParamsSchema,
  LegacyApplyPatchApprovalParamsSchema,
  LegacyExecCommandApprovalParamsSchema,
  LegacyApprovalResponseSchema,
  LocalApprovalDecisionSchema,
  LocalCodexHistoryArchiveResponseSchema,
  LocalCodexHistoryDetailResponseSchema,
  LocalCodexHistoryEntrySchema,
  LocalCodexHistoryPageResponseSchema,
  LocalCodexHistoryResponseSchema,
  LocalCreateSessionResponseSchema,
  LocalEventReplayResponseSchema,
  LocalEventType,
  LocalHealthResponseSchema,
  LocalInterruptResponseSchema,
  LocalLoadedThreadsResponseSchema,
  LocalProviderCatalogResponseSchema,
  LocalResumeSessionResponseSchema,
  LocalResumeSessionSchema,
  LocalSendMessageSchema,
  LocalSendMessageResponseSchema,
  LocalSessionSummarySchema,
  LocalSessionsResponseSchema,
  LocalStartSessionSchema,
  MachineHeartbeatPayloadSchema,
  MachineHelloAckSchema,
  MachineHelloPayloadSchema,
  PairingApproveResponseSchema,
  PairingCreateResponseSchema,
  PairingPollResponseSchema,
  PairingRequestPayloadSchema,
  PairingRequestViewSchema,
  RelayDeviceRecordSchema,
  RelayDevicesResponseSchema,
  RelayErrorAckSchema,
  RelayMethod,
  RelayRpcRequestSchema,
  RelayRpcResponseSchema,
  RelaySessionResponseSchema,
  SidebarPrefsResponseSchema,
  ThreadArchiveParamsSchema,
  ThreadArchiveResponseSchema,
  ThreadGoalClearParamsSchema,
  ThreadGoalClearResponseSchema,
  ThreadGoalGetParamsSchema,
  ThreadGoalGetResponseSchema,
  ThreadGoalSetParamsSchema,
  ThreadGoalSetResponseSchema,
  ThreadLoadedListParamsSchema,
  ThreadLoadedListResponseSchema,
  ThreadListParamsSchema,
  ThreadListResponseSchema,
  ThreadReadParamsSchema,
  ThreadReadResponseSchema,
  ThreadResumeParamsSchema,
  ThreadResumeResponseSchema,
  ThreadStartParamsSchema,
  ThreadStartResponseSchema,
  ThreadTurnsListParamsSchema,
  ThreadTurnsListResponseSchema,
  ThreadUnarchiveParamsSchema,
  ThreadUnarchiveResponseSchema,
  TurnInterruptParamsSchema,
  TurnStartResponseSchema,
  TurnStartParamsSchema,
  TurnSteerParamsSchema,
  codexThreadItemRenderKind,
  codexThreadTurnHasProcessItems,
  isCodexProcessThreadItem,
  makeTextInput,
  appServerNotificationParamsSchemaForMethod,
  parseAppServerNotification
} from "../src/index.js";

describe("relay protocol schemas", () => {
  it("validates relay session responses without owner tokens", () => {
    expect(
      RelaySessionResponseSchema.parse({
        ok: true,
        sessionToken: "relay-session-token"
      })
    ).toEqual({
      ok: true,
      sessionToken: "relay-session-token"
    });
    expect(() =>
      RelaySessionResponseSchema.parse({
        ok: true,
        sessionToken: "relay-session-token",
        ownerToken: "must-not-parse"
      })
    ).toThrow();
  });

  it("validates pairing request and response fixtures", () => {
    const request = PairingRequestPayloadSchema.parse({
      deviceId: "device_1",
      deviceToken: "device-token",
      deviceName: "MacBook",
      hostname: "macbook.local",
      platform: "darwin",
      arch: "arm64",
      agentVersion: "0.1.0",
      codexVersion: null,
      relayUrl: "https://relay.example"
    });
    expect(request.deviceId).toBe("device_1");

    expect(
      PairingCreateResponseSchema.parse({
        requestId: "pair_1",
        pollToken: "poll-token",
        code: "123-456",
        codeDigits: "123456",
        expiresAt: 1,
        approveUrl: null
      })
    ).toMatchObject({ requestId: "pair_1" });

    expect(
      PairingRequestViewSchema.parse({
        requestId: "pair_1",
        codeDigits: "123456",
        deviceId: "device_1",
        deviceName: "MacBook",
        hostname: "macbook.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        codexVersion: null,
        relayUrl: null,
        shortFingerprint: "abcdef123456",
        createdAt: 1,
        expiresAt: 2,
        status: "pending"
      })
    ).toMatchObject({ status: "pending" });

    expect(
      PairingPollResponseSchema.parse({
        ok: true,
        status: "approved",
        deviceId: "device_1",
        expiresAt: 2
      })
    ).toMatchObject({ status: "approved" });

    expect(
      PairingApproveResponseSchema.parse({
        ok: true,
        deviceId: "device_1",
        sessionToken: "relay-session-token"
      })
    ).toMatchObject({ deviceId: "device_1" });
  });

  it("validates device event payload fixtures", () => {
    expect(
      DeviceEventPayloadSchema.parse({
        deviceId: "device_1",
        event: {
          id: "evt_1",
          seq: 1,
          ts: 1,
          type: LocalEventType.ChatUser,
          sessionId: "session_1",
          payload: { text: "hello" }
        }
      })
    ).toMatchObject({
      deviceId: "device_1",
      event: {
        seq: 1,
        type: "chat.user"
      }
    });
    expect(() =>
      DeviceEventPayloadSchema.parse({
        deviceId: "device_1",
        event: {
          id: "evt_bad",
          seq: -1,
          ts: 1,
          type: "chat.user"
        }
      })
    ).toThrow();
  });

  it("validates device presence and machine connection fixtures", () => {
    expect(
      MachineHelloPayloadSchema.parse({
        deviceId: "device_1",
        deviceName: "MacBook",
        hostname: "macbook.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        codexVersion: null,
        startedAt: 1
      })
    ).toMatchObject({ deviceId: "device_1" });

    expect(
      MachineHelloAckSchema.parse({
        ok: true,
        serverTime: 1,
        heartbeatIntervalMs: 15_000
      })
    ).toMatchObject({ ok: true });

    expect(
      RelayErrorAckSchema.parse({
        ok: false,
        error: "unauthorized"
      })
    ).toMatchObject({ ok: false });

    expect(
      MachineHeartbeatPayloadSchema.parse({
        deviceId: "device_1",
        at: 2,
        activeSessions: 1
      })
    ).toMatchObject({ activeSessions: 1 });

    expect(
      DevicePresenceSchema.parse({
        deviceId: "device_1",
        online: true,
        lastSeenAt: 3,
        socketId: "socket_1",
        activeSessions: 2
      })
    ).toMatchObject({ online: true });

    expect(
      RelayDeviceRecordSchema.parse({
        deviceId: "device_1",
        online: true,
        lastSeenAt: 3,
        socketId: "socket_1",
        activeSessions: 2,
        deviceName: "MacBook",
        hostname: "macbook.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        codexVersion: "codex 0.1.0",
        startedAt: 1
      })
    ).toMatchObject({ deviceName: "MacBook" });

    expect(
      RelayDevicesResponseSchema.parse({
        devices: [
          {
            deviceId: "device_1",
            online: false,
            lastSeenAt: 3,
            deviceName: "MacBook",
            hostname: "macbook.local",
            platform: "darwin",
            arch: "arm64",
            agentVersion: "0.1.0",
            agentRunId: "agent_run_1",
            codexVersion: null,
            startedAt: 1
          }
        ]
      }).devices
    ).toHaveLength(1);

    expect(() =>
      RelayDeviceRecordSchema.parse({
        deviceId: "device_1",
        online: true,
        lastSeenAt: 3,
        deviceToken: "must-not-parse",
        deviceName: "MacBook",
        hostname: "macbook.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: 1
      })
    ).toThrow();
  });

  it("validates relay RPC request and response fixtures", () => {
    expect(
      RelayRpcRequestSchema.parse({
        requestId: "rpc_1",
        method: RelayMethod.SessionsMessage,
        params: {
          sessionId: "session_1",
          body: { text: "continue" }
        },
        deadlineMs: 30_000
      })
    ).toMatchObject({ method: "sessions.message" });

    expect(
      RelayRpcResponseSchema.parse({
        ok: true,
        result: {
          mode: "steer",
          turnId: "turn_1"
        }
      })
    ).toMatchObject({ ok: true });

    expect(
      RelayRpcResponseSchema.parse({
        ok: false,
        error: {
          message: "No pending approval",
          code: "not_found",
          data: { approvalId: "approval_1" }
        }
      })
    ).toMatchObject({
      ok: false,
      error: { code: "not_found" }
    });

    expect(() =>
      RelayRpcRequestSchema.parse({
        requestId: "rpc_1",
        method: "sessions.unknown"
      })
    ).toThrow();
  });

  it("validates local session and approval input fixtures", () => {
    expect(
      LocalStartSessionSchema.parse({
        cwd: "/repo",
        serviceTier: "priority",
        permissionMode: "request-approval",
        initialMessage: "hello",
        clientMessageId: "msg_1"
      })
    ).toMatchObject({
      cwd: "/repo",
      permissionMode: "request-approval"
    });

    expect(
      LocalResumeSessionSchema.parse({
        id: "thread_1",
        cwd: "/repo",
        serviceTier: "priority",
        permissionMode: "full-access"
      })
    ).toMatchObject({
      id: "thread_1",
      permissionMode: "full-access"
    });

    expect(
      LocalSendMessageSchema.parse({
        text: "continue",
        clientMessageId: "msg_2",
        serviceTier: "priority"
      })
    ).toMatchObject({ text: "continue" });

    expect(
      LocalApprovalDecisionSchema.parse({
        decision: "decline"
      })
    ).toEqual({ decision: "decline" });
  });

  it("validates method-specific approval response fixtures", () => {
    expect(
      CommandExecutionRequestApprovalResponseSchema.parse({
        decision: "acceptForSession"
      })
    ).toEqual({ decision: "acceptForSession" });
    expect(
      CommandExecutionRequestApprovalResponseSchema.parse({
        decision: { type: "customPolicy", approved: true }
      })
    ).toEqual({
      decision: { type: "customPolicy", approved: true }
    });
    expect(
      FileChangeRequestApprovalResponseSchema.parse({
        decision: "cancel"
      })
    ).toEqual({ decision: "cancel" });
    expect(
      LegacyApprovalResponseSchema.parse({
        decision: "approved_for_session"
      })
    ).toEqual({ decision: "approved_for_session" });
    expect(
      LegacyApprovalResponseSchema.parse({
        decision: { type: "customLegacyPolicy", approved: false }
      })
    ).toEqual({
      decision: { type: "customLegacyPolicy", approved: false }
    });
    expect(
      ApprovalResponseSchema.parse({
        decision: "decline"
      })
    ).toEqual({ decision: "decline" });

    expect(() =>
      FileChangeRequestApprovalResponseSchema.parse({
        decision: { type: "not-valid-for-file-change" }
      })
    ).toThrow();
    expect(() =>
      CommandExecutionRequestApprovalResponseSchema.parse({
        decision: "approved"
      })
    ).toThrow();
    expect(() =>
      LegacyApprovalResponseSchema.parse({
        decision: "accept"
      })
    ).toThrow();
  });

  it("validates server-initiated approval request params", () => {
    expect(
      CommandExecutionRequestApprovalParamsSchema.parse({
        requestId: "approval_1",
        threadId: "thread_1",
        turnId: "turn_1",
        command: ["pnpm", "test"],
        cwd: "/repo"
      })
    ).toMatchObject({ threadId: "thread_1", turnId: "turn_1" });
    expect(
      FileChangeRequestApprovalParamsSchema.parse({
        requestId: "approval_2",
        threadId: "thread_1",
        path: "src/index.ts",
        changes: [{ type: "modify" }]
      })
    ).toMatchObject({ path: "src/index.ts" });
    expect(
      LegacyExecCommandApprovalParamsSchema.parse({
        command: "pnpm test",
        reason: "legacy"
      })
    ).toMatchObject({ command: "pnpm test" });
    expect(
      LegacyApplyPatchApprovalParamsSchema.parse({
        patch: "*** Begin Patch",
        reason: "legacy"
      })
    ).toMatchObject({ patch: "*** Begin Patch" });
    expect(
      ApprovalRequestParamsSchema.parse({
        threadId: "thread_1",
        appServerSpecificField: true
      })
    ).toMatchObject({ threadId: "thread_1" });

    expect(() =>
      CommandExecutionRequestApprovalParamsSchema.parse("not-an-object")
    ).toThrow();
    expect(() =>
      FileChangeRequestApprovalParamsSchema.parse({ threadId: "" })
    ).toThrow();
    expect(() =>
      LegacyApplyPatchApprovalParamsSchema.parse({ turnId: 123 })
    ).toThrow();
  });

  it("validates app-server notification envelopes and known params", () => {
    expect(
      AppServerNotificationSchema.parse({
        method: CodexNotificationMethod.TurnStarted,
        params: {
          threadId: "thread_1",
          turn: {
            id: "turn_1",
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
            extra: true
          }
        },
        passthrough: true
      })
    ).toMatchObject({
      method: "turn/started",
      params: {
        threadId: "thread_1",
        turn: { id: "turn_1" }
      },
      passthrough: true
    });

    const goalNotification = parseAppServerNotification({
      method: CodexNotificationMethod.ThreadGoalUpdated,
      params: {
        goal: threadGoal(),
        extra: "kept"
      }
    });
    expect(goalNotification).toMatchObject({
      method: "thread/goal/updated",
      params: {
        goal: { threadId: "thread_1" },
        extra: "kept"
      }
    });

    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.AgentMessageDelta,
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_agent",
          delta: "hello"
        }
      })
    ).toMatchObject({
      params: { itemId: "item_agent", delta: "hello" }
    });

    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.ItemStarted,
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          startedAtMs: 1_786_000_000_000,
          item: {
            id: "item_cmd",
            type: "commandExecution",
            command: "pnpm test",
            cwd: "/repo",
            processId: null,
            source: "shell",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null
          }
        }
      })
    ).toMatchObject({
      params: {
        item: {
          id: "item_cmd",
          type: CodexThreadItemType.CommandExecution
        }
      }
    });

    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.ReasoningSummaryTextDelta,
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_reasoning",
          summaryIndex: 0,
          delta: "checked files"
        }
      })
    ).toMatchObject({
      params: { itemId: "item_reasoning", summaryIndex: 0 }
    });

    expect(
      appServerNotificationParamsSchemaForMethod(
        CodexNotificationMethod.CommandExecOutputDelta
      )?.parse({
        processId: "process_1",
        stream: "stdout",
        deltaBase64: "aGVsbG8=",
        capReached: false
      })
    ).toEqual({
      processId: "process_1",
      stream: "stdout",
      deltaBase64: "aGVsbG8=",
      capReached: false
    });
  });

  it("rejects malformed known app-server notification params", () => {
    expect(parseAppServerNotification({ method: "" })).toBeUndefined();
    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.AgentMessageDelta,
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          delta: 123
        }
      })
    ).toBeUndefined();
    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.TurnCompleted,
        params: { turn: { id: "" } }
      })
    ).toBeUndefined();
    expect(
      parseAppServerNotification({
        method: CodexNotificationMethod.ThreadGoalUpdated,
        params: { goal: { ...threadGoal(), threadId: "" } }
      })
    ).toBeUndefined();
  });

  it("keeps unknown app-server notification methods passthrough", () => {
    expect(
      parseAppServerNotification({
        method: "vendor/custom",
        params: { delta: 123, anyShape: true }
      })
    ).toEqual({
      method: "vendor/custom",
      params: { delta: 123, anyShape: true }
    });
  });

  it("validates outbound Codex app-server request params", () => {
    expect(
      InitializeParamsSchema.parse({
        clientInfo: {
          name: "codexnext_agent",
          title: "CodexNext Agent",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      }).clientInfo.name
    ).toBe("codexnext_agent");

    expect(
      ThreadStartParamsSchema.parse({
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo"],
        serviceTier: "priority",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "workspace-write"
      })
    ).toMatchObject({ cwd: "/repo" });

    expect(
      ThreadResumeParamsSchema.parse({
        threadId: "thread_1",
        serviceTier: "priority",
        initialTurnsPage: {
          limit: 20,
          sortDirection: "desc",
          itemsView: "summary"
        },
        config: { feature: true },
        personality: { profile: "concise" }
      })
    ).toMatchObject({ threadId: "thread_1" });

    expect(
      ThreadArchiveParamsSchema.parse({ threadId: "thread_1" })
    ).toEqual({ threadId: "thread_1" });
    expect(
      ThreadUnarchiveParamsSchema.parse({ threadId: "thread_1" })
    ).toEqual({ threadId: "thread_1" });
    expect(ThreadLoadedListParamsSchema.parse({})).toEqual({});

    expect(
      ThreadListParamsSchema.parse({
        cursor: "cursor_1",
        limit: 25,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli", "appServer"],
        cwd: ["/repo", "/repo/packages"]
      })
    ).toMatchObject({ limit: 25 });

    expect(
      ThreadReadParamsSchema.parse({
        threadId: "thread_1",
        includeTurns: true
      })
    ).toEqual({ threadId: "thread_1", includeTurns: true });
    expect(
      ThreadTurnsListParamsSchema.parse({
        threadId: "thread_1",
        limit: 10,
        itemsView: "full"
      })
    ).toMatchObject({ threadId: "thread_1" });

    expect(
      ThreadGoalSetParamsSchema.parse({
        threadId: "thread_1",
        objective: "ship it",
        status: "active",
        tokenBudget: 1000
      })
    ).toMatchObject({ status: "active" });
    expect(
      ThreadGoalGetParamsSchema.parse({ threadId: "thread_1" })
    ).toEqual({ threadId: "thread_1" });
    expect(
      ThreadGoalClearParamsSchema.parse({ threadId: "thread_1" })
    ).toEqual({ threadId: "thread_1" });

    expect(
      TurnStartParamsSchema.parse({
        threadId: "thread_1",
        serviceTier: "priority",
        input: [makeTextInput("continue")]
      })
    ).toMatchObject({ threadId: "thread_1" });
    expect(
      TurnSteerParamsSchema.parse({
        threadId: "thread_1",
        expectedTurnId: "turn_1",
        input: [makeTextInput("continue")]
      })
    ).toMatchObject({ expectedTurnId: "turn_1" });
    expect(
      TurnInterruptParamsSchema.parse({
        threadId: "thread_1",
        turnId: "turn_1"
      })
    ).toEqual({ threadId: "thread_1", turnId: "turn_1" });

    expect(() => ThreadReadParamsSchema.parse({ threadId: "" })).toThrow();
    expect(() => ThreadListParamsSchema.parse({ limit: 0 })).toThrow();
    expect(() =>
      ThreadTurnsListParamsSchema.parse({
        threadId: "thread_1",
        itemsView: "compact"
      })
    ).toThrow();
    expect(() =>
      TurnStartParamsSchema.parse({
        threadId: "thread_1",
        input: []
      })
    ).toThrow();
    expect(() =>
      TurnSteerParamsSchema.parse({
        threadId: "thread_1",
        expectedTurnId: "turn_1",
        input: [{ type: "text", text: "missing elements" }]
      })
    ).toThrow();
    expect(() =>
      ThreadLoadedListParamsSchema.parse({
        extra: true
      })
    ).toThrow();
  });

  it("validates goal and turn success response fixtures", () => {
    const goal = {
      threadId: "thread_1",
      objective: "ship it",
      status: "active",
      tokenBudget: null,
      tokensUsed: 10,
      timeUsedSeconds: 2,
      createdAt: 1,
      updatedAt: 2
    };

    expect(ThreadGoalSetResponseSchema.parse({ goal })).toEqual({ goal });
    expect(ThreadGoalGetResponseSchema.parse({ goal })).toEqual({ goal });
    expect(ThreadGoalGetResponseSchema.parse({ goal: null })).toEqual({
      goal: null
    });
    expect(ThreadGoalClearResponseSchema.parse({})).toEqual({});
    expect(ThreadGoalClearResponseSchema.parse({ goal: null })).toEqual({
      goal: null
    });
    expect(
      TurnStartResponseSchema.parse({
        turn: {
          id: "turn_1",
          status: "inProgress",
          appServerSpecificField: true
        }
      })
    ).toMatchObject({ turn: { id: "turn_1" } });

    expect(() =>
      ThreadGoalSetResponseSchema.parse({
        goal: { ...goal, threadId: "" }
      })
    ).toThrow();
    expect(() =>
      ThreadGoalGetResponseSchema.parse({
        goal: { ...goal, status: "waiting" }
      })
    ).toThrow();
    expect(() =>
      TurnStartResponseSchema.parse({
        turn: { id: "" }
      })
    ).toThrow();
  });

  it("validates lower-level Codex app-server thread response fixtures", () => {
    const thread = CodexThreadSchema.parse(codexThread());
    const turn = CodexThreadTurnSchema.parse(codexTurn());

    expect(thread.id).toBe("thread_1");
    expect(turn.items[0]?.type).toBe(CodexThreadItemType.AgentMessage);
    expect(codexThreadItemRenderKind(turn.items[0])).toBe("assistant");
    expect(isCodexProcessThreadItem(turn.items[1])).toBe(true);
    expect(codexThreadTurnHasProcessItems(turn)).toBe(true);
    expect(
      ThreadStartResponseSchema.parse({
        thread: {
          id: "thread_1",
          cwd: "/repo",
          status: { type: "loaded" },
          extra: true
        }
      }).thread.id
    ).toBe("thread_1");
    expect(
      ThreadListResponseSchema.parse({
        data: [thread],
        nextCursor: null,
        backwardsCursor: "older"
      }).data
    ).toHaveLength(1);
    expect(ThreadLoadedListResponseSchema.parse({ data: [thread] }).data).toHaveLength(1);
    expect(ThreadReadResponseSchema.parse({ thread }).thread.id).toBe("thread_1");
    expect(
      ThreadTurnsListResponseSchema.parse({
        data: [turn],
        nextCursor: null,
        backwardsCursor: null
      }).data
    ).toHaveLength(1);
    expect(ThreadArchiveResponseSchema.parse({})).toEqual({});
    expect(ThreadUnarchiveResponseSchema.parse({})).toEqual({});
    expect(
      ThreadResumeResponseSchema.parse({
        thread: { id: "thread_1", cwd: "/repo" },
        cwd: "/repo",
        initialTurnsPage: {
          data: [turn],
          nextCursor: null,
          backwardsCursor: null
        },
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        reasoningEffort: "minimal"
      }).thread.id
    ).toBe("thread_1");
  });

  it("rejects malformed lower-level Codex app-server responses", () => {
    expect(() =>
      ThreadListResponseSchema.parse({
        data: [{ ...codexThread(), id: "" }],
        nextCursor: null,
        backwardsCursor: null
      })
    ).toThrow();
    expect(() =>
      ThreadTurnsListResponseSchema.parse({
        data: [{ ...codexTurn(), items: "not-array" }],
        nextCursor: null,
        backwardsCursor: null
      })
    ).toThrow();
    expect(() => ThreadArchiveResponseSchema.parse({ ok: true })).toThrow();
    expect(() =>
      ThreadResumeResponseSchema.parse({
        thread: { id: "" }
      })
    ).toThrow();
  });

  it("validates local response fixtures used by relay Web and mobile clients", () => {
    const session = LocalSessionSummarySchema.parse({
      sessionId: "session_1",
      threadId: "thread_1",
      activeTurnId: "turn_1",
      status: "running",
      cwd: "/repo",
      title: "Implement feature",
      model: "gpt-5",
      serviceTier: "priority",
      reasoningEffort: "medium",
      permissionMode: "request-approval",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      goal: {
        threadId: "thread_1",
        objective: "Ship it",
        status: "active",
        tokenBudget: 1000,
        tokensUsed: 10,
        timeUsedSeconds: 2,
        createdAt: 1,
        updatedAt: 2
      },
      createdAt: 1,
      updatedAt: 2
    });
    expect(session.sessionId).toBe("session_1");

    expect(
      LocalSessionsResponseSchema.parse({
        sessions: [session]
      }).sessions
    ).toHaveLength(1);
    expect(
      LocalCreateSessionResponseSchema.parse({
        session
      }).session.sessionId
    ).toBe("session_1");

    expect(
      LocalHealthResponseSchema.parse({
        ok: true,
        version: "0.1.0",
        pid: 123,
        uptimeSeconds: 1,
        host: "relay",
        port: 0,
        device: {
          defaultName: "MacBook",
          hostname: "macbook.local",
          platform: "darwin"
        },
        codex: {
          available: true,
          version: "codex 0.1.0"
        },
        codexProvider: {
          available: false,
          error: "missing @codex-provider/core"
        }
      })
    ).toMatchObject({
      ok: true,
      codexProvider: {
        available: false,
        error: "missing @codex-provider/core"
      }
    });

    expect(
      LocalProviderCatalogResponseSchema.parse({
        available: true,
        providers: [
          {
            preset: "openrouter",
            label: "OpenRouter",
            providerLabel: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiKeyEnv: "OPENROUTER_API_KEY",
            apiKeyConfigured: true,
            defaultModel: "deepseek/deepseek-v4-pro",
            models: [
              {
                id: "deepseek/deepseek-v4-pro",
                label: "DeepSeek V4 Pro",
                isDefault: true,
                supportedReasoningEfforts: ["high", "xhigh"]
              }
            ]
          }
        ]
      }).providers[0]?.apiKeyConfigured
    ).toBe(true);

    expect(
      LocalSendMessageResponseSchema.parse({
        mode: "steer",
        turnId: "turn_1"
      })
    ).toEqual({ mode: "steer", turnId: "turn_1" });
    expect(LocalSendMessageSchema.parse({
      text: "queue this",
      serviceTier: "priority",
      submitMode: "queue"
    })).toEqual({
      text: "queue this",
      serviceTier: "priority",
      submitMode: "queue"
    });
    expect(
      LocalSendMessageResponseSchema.parse({
        mode: "queued",
        queuePosition: 1
      })
    ).toEqual({ mode: "queued", queuePosition: 1 });
    expect(LocalInterruptResponseSchema.parse({ turnId: "turn_1" })).toEqual({
      turnId: "turn_1"
    });
    expect(
      LocalEventReplayResponseSchema.parse({
        events: [
          {
            id: "evt_1",
            seq: 1,
            ts: 1,
            type: LocalEventType.ChatUser,
            sessionId: "session_1",
            payload: { text: "continue" }
          }
        ]
      }).events
    ).toHaveLength(1);
    expect(
      SidebarPrefsResponseSchema.parse({
        project: {
          hidden: ["/tmp/old"],
          pinned: ["/repo"],
          renamed: {
            "/repo": "repo"
          }
        },
        thread: {
          pinned: ["thread_1"]
        }
      })
    ).toMatchObject({ thread: { pinned: ["thread_1"] } });
  });

  it("validates Codex history response fixtures", () => {
    const entry = LocalCodexHistoryEntrySchema.parse(historyEntry());
    const message = {
      id: "msg_1",
      role: "assistant",
      text: "done",
      ts: "2026-01-01T00:00:01.000Z"
    };
    const session = sessionSummary();
    const page = {
      entry,
      messages: [message],
      nextCursor: null,
      backwardsCursor: "older"
    };

    expect(
      LocalCodexHistoryResponseSchema.parse({
        root: "/repo",
        entries: [entry]
      }).entries
    ).toHaveLength(1);
    expect(
      LocalLoadedThreadsResponseSchema.parse({
        threadIds: ["thread_1"]
      })
    ).toEqual({ threadIds: ["thread_1"] });
    expect(
      LocalCodexHistoryDetailResponseSchema.parse({
        entry,
        messages: [message]
      }).messages[0]?.role
    ).toBe("assistant");
    expect(LocalCodexHistoryPageResponseSchema.parse(page)).toMatchObject({
      backwardsCursor: "older"
    });
    expect(LocalCodexHistoryArchiveResponseSchema.parse({})).toEqual({});
    expect(
      LocalResumeSessionResponseSchema.parse({
        session,
        history: page
      }).session.sessionId
    ).toBe("session_1");
  });

  it("rejects malformed Codex history response fixtures", () => {
    expect(() =>
      LocalCodexHistoryEntrySchema.parse({
        ...historyEntry(),
        id: ""
      })
    ).toThrow();
    expect(() =>
      LocalCodexHistoryDetailResponseSchema.parse({
        entry: historyEntry(),
        messages: [{ id: "msg_1", role: "unknown", text: "x", ts: "1" }]
      })
    ).toThrow();
    expect(() =>
      LocalCodexHistoryPageResponseSchema.parse({
        entry: historyEntry(),
        messages: [],
        nextCursor: 1,
        backwardsCursor: null
      })
    ).toThrow();
    expect(() =>
      LocalCodexHistoryArchiveResponseSchema.parse({
        ok: true
      })
    ).toThrow();
  });

  it("rejects malformed local response fixtures", () => {
    expect(() =>
      LocalSessionSummarySchema.parse({
        sessionId: "session_1",
        status: "unknown",
        cwd: "/repo",
        permissionMode: "request-approval",
        approvalPolicy: null,
        approvalsReviewer: null,
        sandbox: null,
        createdAt: 1,
        updatedAt: 2
      })
    ).toThrow();
    expect(() =>
      LocalHealthResponseSchema.parse({
        ok: true,
        version: "0.1.0",
        pid: "123",
        uptimeSeconds: 1,
        host: "relay",
        port: 0
      })
    ).toThrow();
    expect(() =>
      LocalSendMessageResponseSchema.parse({
        mode: "unexpected",
        turnId: "turn_1"
      })
    ).toThrow();
    expect(() =>
      SidebarPrefsResponseSchema.parse({
        project: {
          hidden: [],
          pinned: [],
          renamed: {
            "/repo": ""
          }
        },
        thread: { pinned: [] }
      })
    ).toThrow();
  });
});

function historyEntry() {
  return {
    id: "thread_1",
    cwd: "/repo",
    cwdExists: true,
    title: "Implement feature",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    source: "codex",
    loaded: true,
    threadStatus: "loaded"
  };
}

function sessionSummary() {
  return {
    sessionId: "session_1",
    threadId: "thread_1",
    activeTurnId: "turn_1",
    status: "running",
    cwd: "/repo",
    title: "Implement feature",
    model: "gpt-5",
    reasoningEffort: "medium",
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    createdAt: 1,
    updatedAt: 2
  };
}

function codexThread() {
  return {
    id: "thread_1",
    sessionId: "session_1",
    preview: "Implement feature",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "loaded" },
    cwd: "/repo",
    cliVersion: "0.1.0",
    source: { kind: "cli" },
    title: "Implement feature",
    name: null,
    path: null,
    turns: [codexTurn()],
    passthrough: true
  };
}

function codexTurn() {
  return {
    id: "turn_1",
    items: [
      {
        id: "item_1",
        type: "agentMessage",
        text: "done"
      },
      {
        id: "item_2",
        type: "reasoning",
        summary: ["checked repo"],
        content: []
      }
    ],
    itemsView: "full",
    params: { model: "gpt-5" },
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1_000
  };
}

function threadGoal() {
  return {
    threadId: "thread_1",
    objective: "ship it",
    status: "active",
    tokenBudget: null,
    tokensUsed: 10,
    timeUsedSeconds: 2,
    createdAt: 1,
    updatedAt: 2
  };
}
