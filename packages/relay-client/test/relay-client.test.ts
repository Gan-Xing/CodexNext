import { describe, expect, it } from "vitest";
import type { DeviceEventPayload, LocalEvent } from "@codexnext/protocol";
import {
  acceptLiveEvent,
  buildApprovalDecisionBody,
  buildApprovalDecisionUrl,
  buildCodexHistoryArchiveUrl,
  buildCodexHistoryDetailUrl,
  buildCodexHistoryResumeUrl,
  buildCodexHistoryTurnsUrl,
  buildCodexHistoryUrl,
  buildDeviceHealthUrl,
  buildDeviceEventReplayUrl,
  buildDeviceSessionsUrl,
  buildDeviceSidebarPrefsUrl,
  buildLoadedCodexHistoryUrl,
  buildRelayAuthorizationHeaders,
  buildRelayDevicesUrl,
  buildSessionMessageUrl,
  buildTurnInterruptUrl,
  buildUserRelayAuth,
  filterReplayEvents,
  nextSeqAfterEvents,
  normalizeRelayUrl,
  parseCodexHistoryArchiveResponse,
  parseCodexHistoryDetailResponse,
  parseCodexHistoryPageResponse,
  parseCodexHistoryResponse,
  parseLoadedCodexHistoryResponse,
  parseLocalCreateSessionResponse,
  parseLocalEventReplayResponse,
  parseLocalHealthResponse,
  parseLocalInterruptResponse,
  parseResumeSessionResponse,
  parseLocalSendMessageResponse,
  parseLocalSessionsResponse,
  parseRelayDevicesResponse,
  parseSidebarPrefsResponse
} from "../src/index.js";

function event(seq: number, type: LocalEvent["type"] = "chat.user"): LocalEvent {
  return {
    id: `evt_${seq}`,
    seq,
    ts: seq,
    type
  };
}

function payload(deviceId: string, seq: number): DeviceEventPayload {
  return {
    deviceId,
    event: event(seq)
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

describe("relay client contract helpers", () => {
  it("builds user auth without owner or device tokens", () => {
    expect(
      buildUserRelayAuth(
        {
          deviceId: "device_1",
          sessionToken: "relay-session-token"
        },
        4.8
      )
    ).toEqual({
      clientType: "user",
      sessionToken: "relay-session-token",
      lastSeqByDevice: {
        device_1: 4
      }
    });
  });

  it("filters replay batches by device, sequence, and stable order", () => {
    const replay = filterReplayEvents(
      [
        payload("device_other", 99),
        payload("device_1", 3),
        payload("device_1", 2),
        payload("device_1", 3),
        payload("device_1", 1)
      ],
      "device_1",
      1
    );

    expect(replay.map((item) => item.seq)).toEqual([2, 3]);
    expect(nextSeqAfterEvents(1, replay)).toBe(3);
  });

  it("accepts only newer live events for the selected device", () => {
    expect(acceptLiveEvent(payload("device_other", 8), "device_1", 7)).toBeNull();
    expect(acceptLiveEvent(payload("device_1", 7), "device_1", 7)).toBeNull();
    expect(acceptLiveEvent(payload("device_1", 8), "device_1", 7)).toMatchObject({
      seq: 8
    });
  });

  it("normalizes relay urls without preserving secret-bearing query strings", () => {
    expect(normalizeRelayUrl(" https://relay.example/control///?token=leak#x ")).toBe(
      "https://relay.example/control"
    );
  });

  it("builds shared HTTP URLs and auth headers for Web and mobile clients", () => {
    const connection = {
      relayUrl: "https://relay.example/control///?token=leak#x",
      sessionToken: "relay-session-token",
      deviceId: "device/one"
    };

    expect(buildRelayDevicesUrl(connection.relayUrl).toString()).toBe(
      "https://relay.example/api/devices"
    );
    expect(buildDeviceSidebarPrefsUrl(connection.relayUrl, connection.deviceId).toString()).toBe(
      "https://relay.example/api/devices/device%2Fone/sidebar-prefs"
    );
    expect(buildDeviceHealthUrl(connection).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/health"
    );
    expect(buildDeviceSessionsUrl(connection).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/sessions"
    );
    expect(buildSessionMessageUrl(connection, "session/1").toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/sessions/session%2F1/messages"
    );
    expect(buildTurnInterruptUrl(connection, "session/1", "turn/1").toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/sessions/session%2F1/turns/turn%2F1/interrupt"
    );
    expect(buildCodexHistoryUrl(connection, 12.8).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history?limit=12"
    );
    expect(buildLoadedCodexHistoryUrl(connection).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history/loaded"
    );
    expect(
      buildCodexHistoryDetailUrl(connection, {
        id: "thread/1",
        cwd: "/tmp/repo"
      }).toString()
    ).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history/detail?id=thread%2F1&cwd=%2Ftmp%2Frepo"
    );
    expect(
      buildCodexHistoryTurnsUrl(connection, {
        id: "thread/1",
        cwd: "/tmp/repo",
        cursor: "older/1",
        limit: 25.9
      }).toString()
    ).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history/turns?id=thread%2F1&cwd=%2Ftmp%2Frepo&cursor=older%2F1&limit=25&sortDirection=desc&itemsView=summary"
    );
    expect(buildCodexHistoryArchiveUrl(connection).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history/archive"
    );
    expect(buildCodexHistoryResumeUrl(connection).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/codex-history/resume"
    );
    expect(buildDeviceEventReplayUrl(connection, 4.8).toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/events?after=4"
    );
    expect(buildApprovalDecisionUrl(connection, "approval/1").toString()).toBe(
      "https://relay.example/api/relay/devices/device%2Fone/approvals/approval%2F1/decision"
    );
    expect(buildRelayAuthorizationHeaders(connection.sessionToken)).toEqual({
      Authorization: "Bearer relay-session-token"
    });
    expect(buildApprovalDecisionBody("acceptForSession")).toBe(
      JSON.stringify({ decision: "acceptForSession" })
    );
  });

  it("parses shared HTTP responses for Web and mobile clients", () => {
    const session = sessionSummary();

    expect(
      parseRelayDevicesResponse({
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
            codexVersion: null,
            startedAt: 1
          }
        ]
      })[0]?.deviceId
    ).toBe("device_1");

    expect(
      parseSidebarPrefsResponse({
        project: {
          hidden: ["/tmp/old"],
          pinned: ["/repo"],
          renamed: { "/repo": "repo" }
        },
        thread: { pinned: ["thread_1"] }
      }).project.pinned
    ).toEqual(["/repo"]);

    expect(
      parseLocalHealthResponse({
        ok: true,
        version: "0.1.0",
        pid: 123,
        uptimeSeconds: 1,
        host: "relay",
        port: 0,
        codex: { available: true, version: "codex 0.1" }
      }).codex
    ).toMatchObject({ available: true });

    expect(parseLocalSessionsResponse({ sessions: [session] }).sessions[0]).toMatchObject({
      sessionId: "session_1"
    });
    expect(parseLocalCreateSessionResponse({ session }).session.sessionId).toBe(
      "session_1"
    );
    expect(parseLocalSendMessageResponse({ mode: "steer", turnId: "turn_1" })).toEqual({
      mode: "steer",
      turnId: "turn_1"
    });
    expect(parseLocalInterruptResponse({ turnId: "turn_1" })).toEqual({
      turnId: "turn_1"
    });

    expect(
      parseLocalEventReplayResponse(
        {
          events: [event(3), event(2), event(3), event(1)]
        },
        1.7
      ).map((item) => item.seq)
    ).toEqual([2, 3]);
  });

  it("parses Codex history responses for Web and mobile clients", () => {
    const entry = historyEntry();
    const page = historyPage();
    const session = sessionSummary();

    expect(
      parseCodexHistoryResponse({
        root: "/repo",
        entries: [entry]
      }).entries[0]?.id
    ).toBe("thread_1");
    expect(parseLoadedCodexHistoryResponse({ threadIds: ["thread_1"] })).toEqual({
      threadIds: ["thread_1"]
    });
    expect(
      parseCodexHistoryDetailResponse({
        entry,
        messages: page.messages
      }).messages[0]?.role
    ).toBe("assistant");
    expect(parseCodexHistoryPageResponse(page).backwardsCursor).toBe("older");
    expect(parseCodexHistoryArchiveResponse({})).toEqual({});
    expect(
      parseResumeSessionResponse({
        session,
        history: page
      }).history.entry.id
    ).toBe("thread_1");
  });

  it("throws stable parser errors without embedding raw relay payloads", () => {
    expect(() =>
      parseRelayDevicesResponse({
        devices: "not-array",
        sessionToken: "relay-session-token"
      })
    ).toThrow("Invalid relay response: device list");
    expect(() =>
      parseSidebarPrefsResponse({
        project: { hidden: [], pinned: [], renamed: { "/repo": "" } },
        thread: { pinned: [] }
      })
    ).toThrow("Invalid relay response: sidebar preferences");
    expect(() =>
      parseLocalHealthResponse({
        ok: true,
        version: "0.1.0",
        pid: "relay-session-token",
        uptimeSeconds: 1,
        host: "relay",
        port: 0
      })
    ).toThrow("Invalid relay response: health");
    expect(() =>
      parseLocalSessionsResponse({ sessions: [{ ...sessionSummary(), status: "unknown" }] })
    ).toThrow("Invalid relay response: sessions");
    expect(() =>
      parseLocalCreateSessionResponse({ session: { ...sessionSummary(), cwd: "" } })
    ).toThrow("Invalid relay response: session create");
    expect(() =>
      parseLocalSendMessageResponse({ mode: "unexpected", turnId: "turn_1" })
    ).toThrow("Invalid relay response: session message");
    expect(() => parseLocalInterruptResponse({ turnId: "" })).toThrow(
      "Invalid relay response: turn interrupt"
    );
    expect(() =>
      parseLocalEventReplayResponse({
        events: [{ id: "evt_bad", seq: -1, ts: 1, type: "chat.user" }]
      })
    ).toThrow("Invalid relay response: event replay");
    expect(() =>
      parseCodexHistoryResponse({ root: "/repo", entries: [{ ...historyEntry(), id: "" }] })
    ).toThrow("Invalid relay response: codex history");
    expect(() => parseLoadedCodexHistoryResponse({ threadIds: [""] })).toThrow(
      "Invalid relay response: loaded codex history"
    );
    expect(() =>
      parseCodexHistoryDetailResponse({
        entry: historyEntry(),
        messages: [{ id: "msg_1", role: "unknown", text: "x", ts: "1" }]
      })
    ).toThrow("Invalid relay response: codex history detail");
    expect(() =>
      parseCodexHistoryPageResponse({
        ...historyPage(),
        nextCursor: 1
      })
    ).toThrow("Invalid relay response: codex history page");
    expect(() => parseCodexHistoryArchiveResponse({ ok: true })).toThrow(
      "Invalid relay response: codex history archive"
    );
    expect(() =>
      parseResumeSessionResponse({
        session: { ...sessionSummary(), status: "unknown" },
        history: historyPage()
      })
    ).toThrow("Invalid relay response: codex history resume");

    try {
      parseLocalHealthResponse({
        ok: true,
        version: "0.1.0",
        pid: "relay-session-token",
        uptimeSeconds: 1,
        host: "relay",
        port: 0
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("relay-session-token");
    }
  });
});
