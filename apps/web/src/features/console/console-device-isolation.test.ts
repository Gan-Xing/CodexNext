import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controllerSource = readFileSync(
  new URL("./use-web-console-controller.ts", import.meta.url),
  "utf8"
);

function extractFunctionBody(name: string): string {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "u");
  const match = pattern.exec(controllerSource);
  expect(match, `missing function ${name}`).not.toBeNull();
  const functionStart = match!.index;
  const bodyStart = controllerSource.indexOf("{", functionStart);
  expect(bodyStart, `missing body for ${name}`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = bodyStart; index < controllerSource.length; index += 1) {
    const char = controllerSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return controllerSource.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`unterminated function ${name}`);
}

describe("console device isolation invariants", () => {
  it("keeps session request settings scoped to the active device workspace", () => {
    expect(controllerSource).toContain(
      'const permissionMode = activeWorkspace?.permissionMode ?? "request-approval";'
    );
    expect(controllerSource).toContain(
      'const reasoningEffort = activeWorkspace?.reasoningEffort ?? "xhigh";'
    );
    expect(controllerSource).toContain("setPermissionMode: setWorkspacePermissionMode");
    expect(controllerSource).toContain("setReasoningEffort: setWorkspaceReasoningEffort");
    expect(controllerSource).not.toContain("const [permissionMode, setPermissionMode]");
    expect(controllerSource).not.toContain("const [reasoningEffort, setReasoningEffort]");
  });

  it("keeps async submit writes pinned to the originating device", () => {
    const submitBody = extractFunctionBody("submitComposer");

    expect(submitBody).toContain("const submitDeviceId = selectedDeviceIdRef.current;");
    expect(submitBody).not.toContain("deviceId: selectedDeviceIdRef.current");
    expect(submitBody).not.toContain("patchActiveWorkspace(");
    expect(submitBody).toContain("setErrorForDevice(submitContext.deviceId");
    expect(submitBody).toContain("setActiveSheetForDevice(sentContext.deviceId, null)");
  });

  it("does not write async resume, goal, approval, or queue RPC results or errors to the current device by accident", () => {
    const guardedFunctions = [
      "resumeHistorySessionForMessage",
      "resumeHistorySessionForGoal",
      "failPendingSessionMessageQueue",
      "drainPendingSessionMessageQueue",
      "setGoalForSession",
      "clearGoal",
      "refreshGoal",
      "decideApproval",
      "updateCurrentSessionQueue"
    ];

    for (const functionName of guardedFunctions) {
      const body = extractFunctionBody(functionName);
      expect(body, functionName).not.toContain("patchActiveWorkspace(");
      expect(body, functionName).not.toContain("setError(formatConsoleError");
    }
  });

  it("keeps multi-tab localStorage changes converged without preserving deleted device streams", () => {
    expect(controllerSource).toContain(
      'window.addEventListener("storage", handleConsoleStorageChange)'
    );
    expect(controllerSource).toContain(
      'window.removeEventListener("storage", handleConsoleStorageChange)'
    );
    expect(controllerSource).toContain("const syncSavedDevicesFromStorage = () =>");
    expect(controllerSource).toContain("closeDeviceStream(deviceId);");
    expect(controllerSource).toContain("event.key === savedDevicesStorageKey");
    expect(controllerSource).toContain("event.key === threadSidebarPrefsStorageKey");
    expect(controllerSource).toContain("event.key === projectSidebarPrefsStorageKey");
    expect(controllerSource).toContain("event.key === sessionSelectionStorageKey");
    expect(controllerSource).toContain("event.key === sidebarWidthStorageKey");
    expect(controllerSource).not.toContain("event.storageArea !== window.localStorage");
    expect(controllerSource).not.toContain(
      "currentSessionId,\n    selectedHistoryKey,\n    sessionSelections,\n    sidebarPrefsScopeKey"
    );
  });
});
