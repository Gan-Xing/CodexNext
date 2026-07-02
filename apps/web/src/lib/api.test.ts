import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  archiveCodexHistory,
  getCodexHistoryDetail,
  getCodexHistoryTurns,
  getLoadedCodexThreads,
  getRelaySidebarPrefs,
  health,
  interruptSessionTurn,
  listCodexHistory,
  listRelayDevices,
  listSessions,
  replayEvents,
  resumeCodexHistory,
  resolveAgentUrl,
  sendSessionMessage,
  updateSessionRuntime
} from "./api";
import { buildDeviceSidebarPrefsUrl } from "@codexnext/relay-client";

describe("relay api url mapping", () => {
  const relayConnection = {
    mode: "relay" as const,
    relayUrl: "http://127.0.0.1:3002",
    sessionToken: "session",
    deviceId: "device_1"
  };

  it("maps health to relay device health", () => {
    expect(resolveAgentUrl(relayConnection, "/api/health").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/health"
    );
  });

  it("maps sessions and history endpoints to relay device routes", () => {
    expect(resolveAgentUrl(relayConnection, "/api/sessions").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/sessions"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history?limit=12.8").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history?limit=12"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/codex-history/detail?id=thread_1&cwd=%2Ftmp"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/detail?id=thread_1&cwd=%2Ftmp"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/codex-history/turns?id=thread_1&cursor=older"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/turns?id=thread_1&cursor=older&sortDirection=desc&itemsView=summary"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/codex-history/turns?id=thread_1&cacheMode=bypass"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/turns?id=thread_1&cacheMode=bypass&sortDirection=desc&itemsView=summary"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history/loaded").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/loaded"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history/archive").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/archive"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history/resume").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/resume"
    );
  });

  it("maps approval and goal paths without changing the tail segments", () => {
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/approvals/appr_1/decision"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/approvals/appr_1/decision"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/sessions/session_1/goal"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/sessions/session_1/goal"
    );
  });

  it("uses shared replay and approval URL helpers for encoded mobile-safe paths", () => {
    const encodedConnection = {
      ...relayConnection,
      relayUrl: "http://127.0.0.1:3002/control///?token=leak#x",
      deviceId: "device/1"
    };

    expect(resolveAgentUrl(encodedConnection, "/api/events?after=4.8").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/events?after=4"
    );
    expect(resolveAgentUrl(encodedConnection, "/api/health").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/health"
    );
    expect(resolveAgentUrl(encodedConnection, "/api/sessions").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/sessions"
    );
    expect(
      resolveAgentUrl(
        encodedConnection,
        "/api/sessions/session%2F1/messages"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/sessions/session%2F1/messages"
    );
    expect(
      resolveAgentUrl(
        encodedConnection,
        "/api/sessions/session%2F1/runtime"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/sessions/session%2F1/runtime"
    );
    expect(
      resolveAgentUrl(
        encodedConnection,
        "/api/sessions/session%2F1/turns/turn%2F1/interrupt"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/sessions/session%2F1/turns/turn%2F1/interrupt"
    );
    expect(
      resolveAgentUrl(
        encodedConnection,
        "/api/approvals/approval%2F1/decision"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device%2F1/approvals/approval%2F1/decision"
    );
    expect(buildDeviceSidebarPrefsUrl(encodedConnection.relayUrl, "device/1").toString()).toBe(
      "http://127.0.0.1:3002/api/devices/device%2F1/sidebar-prefs"
    );
  });
});

describe("relay api response parsing", () => {
  const relayConnection = {
    mode: "relay" as const,
    relayUrl: "http://127.0.0.1:3002",
    sessionToken: "session",
    deviceId: "device_1"
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses core relay responses before returning them", async () => {
    const session = sessionFixture();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        devices: [
          {
            deviceId: "device_1",
            online: true,
            lastSeenAt: 3,
            activeSessions: 1,
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
      }))
      .mockResolvedValueOnce(jsonResponse({
        project: { hidden: [], pinned: ["/repo"], renamed: { "/repo": "repo" } },
        thread: { pinned: ["thread_1"] }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        version: "0.1.0",
        pid: 123,
        uptimeSeconds: 1,
        host: "relay",
        port: 0,
        codex: { available: true }
      }))
      .mockResolvedValueOnce(jsonResponse({
        events: [
          { id: "evt_3", seq: 3, ts: 3, type: "chat.user" },
          { id: "evt_2", seq: 2, ts: 2, type: "chat.user" },
          { id: "evt_3b", seq: 3, ts: 4, type: "chat.assistant.delta" }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [session] }))
      .mockResolvedValueOnce(jsonResponse({ session }))
      .mockResolvedValueOnce(jsonResponse({ mode: "steer", turnId: "turn_1" }))
      .mockResolvedValueOnce(jsonResponse({ session: { ...session, model: "gpt-5.4" } }))
      .mockResolvedValueOnce(jsonResponse({ turnId: "turn_1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRelayDevices("http://relay.local", "session")).resolves.toHaveLength(1);
    await expect(
      getRelaySidebarPrefs("http://relay.local", "session", "device_1")
    ).resolves.toMatchObject({ thread: { pinned: ["thread_1"] } });
    await expect(health(relayConnection)).resolves.toMatchObject({
      codex: { available: true }
    });
    await expect(replayEvents(relayConnection, 1)).resolves.toEqual({
      events: [
        { id: "evt_2", seq: 2, ts: 2, type: "chat.user" },
        { id: "evt_3b", seq: 3, ts: 4, type: "chat.assistant.delta" }
      ]
    });
    await expect(listSessions(relayConnection)).resolves.toMatchObject({
      sessions: [{ sessionId: "session_1" }]
    });
    await expect(
      createSession(relayConnection, {
        cwd: "/repo",
        permissionMode: "request-approval"
      })
    ).resolves.toMatchObject({
      session: { sessionId: "session_1" }
    });
    await expect(
      sendSessionMessage(relayConnection, "session_1", { text: "continue" })
    ).resolves.toEqual({ mode: "steer", turnId: "turn_1" });
    await expect(
      updateSessionRuntime(relayConnection, "session_1", { model: "gpt-5.4" })
    ).resolves.toMatchObject({ session: { model: "gpt-5.4" } });
    await expect(
      interruptSessionTurn(relayConnection, "session_1", "turn_1")
    ).resolves.toEqual({ turnId: "turn_1" });
  });

  it("rejects malformed successful relay responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({
        ok: true,
        version: "0.1.0",
        pid: "relay-session-token",
        uptimeSeconds: 1,
        host: "relay",
        port: 0
      }))
    );

    await expect(health(relayConnection)).rejects.toThrow(
      "Invalid relay response: health"
    );
  });

  it("parses Codex history responses before returning them", async () => {
    const session = sessionFixture();
    const page = historyPage();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ root: "/repo", entries: [historyEntry()] }))
      .mockResolvedValueOnce(jsonResponse({ threadIds: ["thread_1"] }))
      .mockResolvedValueOnce(jsonResponse({
        entry: historyEntry(),
        messages: page.messages
      }))
      .mockResolvedValueOnce(jsonResponse(page))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ session, history: page }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listCodexHistory(relayConnection, 12.8)).resolves.toMatchObject({
      entries: [{ id: "thread_1" }]
    });
    await expect(getLoadedCodexThreads(relayConnection)).resolves.toEqual({
      threadIds: ["thread_1"]
    });
    await expect(
      getCodexHistoryDetail(relayConnection, { id: "thread_1", cwd: "/repo" })
    ).resolves.toMatchObject({ messages: [{ role: "assistant" }] });
    await expect(
      getCodexHistoryTurns(relayConnection, { id: "thread_1", cursor: "older" })
    ).resolves.toMatchObject({ backwardsCursor: "older" });
    await expect(archiveCodexHistory(relayConnection, { id: "thread_1" })).resolves.toEqual({});
    await expect(
      resumeCodexHistory(relayConnection, {
        id: "thread_1",
        permissionMode: "request-approval"
      })
    ).resolves.toMatchObject({
      session: { sessionId: "session_1" },
      history: { entry: { id: "thread_1" } }
    });
  });

  it("rejects malformed successful Codex history responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({
        root: "/repo",
        entries: [{ ...historyEntry(), id: "" }]
      }))
    );

    await expect(listCodexHistory(relayConnection)).rejects.toThrow(
      "Invalid relay response: codex history"
    );
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sessionFixture() {
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

function historyPage() {
  return {
    entry: historyEntry(),
    messages: [
      {
        id: "msg_1",
        role: "assistant",
        text: "done",
        ts: "2026-01-01T00:00:01.000Z"
      }
    ],
    nextCursor: null,
    backwardsCursor: "older"
  };
}
