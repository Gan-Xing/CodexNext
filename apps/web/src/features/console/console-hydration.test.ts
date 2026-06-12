import { describe, expect, it } from "vitest";
import type { LocalSessionSummary } from "../../lib/types";
import { createDeviceWorkspace } from "../chat/chat-state";
import {
  mergeLiveHistoryIntoWorkspace,
  mergeLiveSessionsIntoWorkspace,
  resolveHistoryPreviewEntryToHydrate
} from "./console-hydration";
import {
  codexHistoryKey,
  historyPreviewSessionId,
  makeHistoryPreviewSession
} from "../sessions/session-utils";

describe("console hydration helpers", () => {
  it("keeps a restored history preview selected when live sessions arrive", () => {
    const entry = historyEntry();
    const previewSession = makeHistoryPreviewSession(entry);
    const workspace = {
      ...createDeviceWorkspace(connection()),
      codexHistory: [entry],
      currentSessionId: previewSession.sessionId,
      selectedHistoryKey: codexHistoryKey(entry),
      sessions: [previewSession]
    };

    const result = mergeLiveSessionsIntoWorkspace(
      workspace,
      [liveSession()],
      {
        currentSessionId: null,
        selectedHistoryKey: codexHistoryKey(entry)
      }
    );

    expect(result.currentSessionId).toBe(previewSession.sessionId);
    expect(result.selectedHistoryKey).toBe(codexHistoryKey(entry));
    expect(result.sessions.map((session) => session.sessionId)).toEqual([
      previewSession.sessionId,
      "session_live"
    ]);
  });

  it("restores a saved history preview when live history arrives", () => {
    const entry = historyEntry();
    const workspace = createDeviceWorkspace(connection());

    const result = mergeLiveHistoryIntoWorkspace(
      workspace,
      [entry],
      {
        currentSessionId: null,
        selectedHistoryKey: codexHistoryKey(entry)
      }
    );

    expect(result.currentSessionId).toBe(historyPreviewSessionId(entry));
    expect(result.selectedHistoryKey).toBe(codexHistoryKey(entry));
    expect(result.sessions[0]?.sessionId).toBe(historyPreviewSessionId(entry));
  });

  it("does not replace a real session selection with a saved history preview", () => {
    const entry = historyEntry();
    const workspace = {
      ...createDeviceWorkspace(connection()),
      currentSessionId: "session_live",
      selectedHistoryKey: null,
      sessions: [liveSession()]
    };

    const result = mergeLiveHistoryIntoWorkspace(
      workspace,
      [entry],
      {
        currentSessionId: "session_live",
        selectedHistoryKey: codexHistoryKey(entry)
      }
    );

    expect(result.currentSessionId).toBe("session_live");
    expect(result.selectedHistoryKey).toBeNull();
  });

  it("only schedules a history preview hydration when the active selection is preview-like", () => {
    const entry = historyEntry();

    expect(
      resolveHistoryPreviewEntryToHydrate(
        {
          currentSessionId: "session_live",
          selectedHistoryKey: codexHistoryKey(entry)
        },
        [entry],
        {
          currentSessionId: "session_live",
          selectedHistoryKey: codexHistoryKey(entry)
        }
      )
    ).toBeNull();

    expect(
      resolveHistoryPreviewEntryToHydrate(
        {
          currentSessionId: null,
          selectedHistoryKey: codexHistoryKey(entry)
        },
        [entry],
        {
          currentSessionId: null,
          selectedHistoryKey: codexHistoryKey(entry)
        }
      )
    ).toEqual(entry);
  });
});

function connection() {
  return {
    mode: "relay" as const,
    relayUrl: "http://relay.local",
    sessionToken: "session-token",
    deviceId: "device_1"
  };
}

function historyEntry() {
  return {
    id: "thread_1",
    cwd: "/repo",
    cwdExists: true,
    title: "Restore me",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:05:00.000Z",
    source: "history",
    loaded: false,
    threadStatus: "notLoaded" as const
  };
}

function liveSession(): LocalSessionSummary {
  return {
    sessionId: "session_live",
    threadId: "thread_live",
    status: "idle",
    cwd: "/repo",
    title: "Live session",
    model: "gpt-5.5",
    reasoningEffort: "high",
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    goal: null,
    createdAt: 10,
    updatedAt: 20
  };
}
