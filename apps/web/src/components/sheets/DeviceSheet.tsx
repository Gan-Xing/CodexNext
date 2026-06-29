"use client";

import { useEffect, useState } from "react";
import type { AgentConnection } from "../../lib/api";
import {
  approveRelayPairingRequest,
  formatRelayPairCode,
  getRelayPairingRequest,
  normalizeRelayPairCode
} from "../../lib/relay";
import type { LocalHealthResponse, PairingRequestView } from "../../lib/types";
import {
  connectionFromSavedDevice,
  findSavedDevice,
  isSameAgentConnection,
  savedDeviceAddressLabel,
  type DeviceDraftState,
  type DevicePresenceState,
  type SavedDevice
} from "../../features/devices/device-utils";
import { CodexIcon } from "../DesignLab";

type RelayPairStatus =
  | "idle"
  | "loading"
  | "ready"
  | "approving"
  | "waiting"
  | "error";

export function DeviceSheet(props: {
  connected: boolean;
  connection: AgentConnection;
  devicePresence: Record<string, DevicePresenceState>;
  deviceName: string;
  healthStatus: LocalHealthResponse | null;
  migrationNotice: string | null;
  relayConnectionInfo: { accessToken: string; relayUrl: string } | null;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
  streamStatus: string;
  onClose: () => void;
  onConnect: (
    connection: AgentConnection,
    deviceName: string,
    deviceId: string | null
  ) => Promise<void>;
  onDeleteDevice: (deviceId: string) => void;
  onDismissMigrationNotice: () => void;
  onRefreshRelayDevices: () => Promise<SavedDevice[]>;
}) {
  const [draft, setDraft] = useState<DeviceDraftState>(() =>
    createActiveDeviceDraft({
      connection: props.connection,
      deviceName: props.deviceName,
      savedDevices: props.savedDevices,
      selectedDeviceId: props.selectedDeviceId
    })
  );
  const [relayPairMode, setRelayPairMode] = useState(props.savedDevices.length === 0);
  const [relayPairCode, setRelayPairCode] = useState("");
  const [relayPairRequest, setRelayPairRequest] = useState<PairingRequestView | null>(null);
  const [relayPairStatus, setRelayPairStatus] = useState<RelayPairStatus>("idle");
  const [relayPairMessage, setRelayPairMessage] = useState<string | null>(null);

  const draftSavedDevice = draft.selectedDeviceId
    ? props.savedDevices.find((device) => device.id === draft.selectedDeviceId) ?? null
    : null;
  const draftPresence = draftSavedDevice
    ? props.devicePresence[draftSavedDevice.id] ?? null
    : null;
  const draftConnected = Boolean(
    draft.selectedDeviceId &&
      props.connected &&
      draftSavedDevice &&
      connectionFromSavedDevice(
        draftSavedDevice,
        props.relayConnectionInfo?.accessToken ?? null
      ) &&
      isSameAgentConnection(
        connectionFromSavedDevice(
          draftSavedDevice,
          props.relayConnectionInfo?.accessToken ?? null
        )!,
        props.connection
      )
  );
  const draftOnline = draftConnected || draftPresence?.status === "online";
  const draftDisplayName = draft.name.trim() || draftSavedDevice?.name || "新设备";
  const relaySelectedDevice = draftSavedDevice ?? props.savedDevices[0] ?? null;
  const waitingForRelayDevice = props.savedDevices.length === 0;
  const relayUrl =
    props.relayConnectionInfo?.relayUrl ?? relaySelectedDevice?.relayUrl ?? null;
  const relayAccessToken = props.relayConnectionInfo?.accessToken ?? null;
  const pairCodeValue = formatRelayPairCode(relayPairCode);
  const relayPairingVisible = relayPairMode || waitingForRelayDevice;
  const relayPairCommand = relayUrl ? `codexnext pair --relay ${relayUrl}` : "";
  const onlineDeviceCount = props.savedDevices.filter(isSavedDeviceOnline).length;
  const deviceSummaryLabel =
    props.savedDevices.length === 0
      ? "暂无设备"
      : `${props.savedDevices.length} 台设备 · ${onlineDeviceCount} 在线`;
  const headerStatusLabel = relayPairingVisible
    ? "配对中"
    : draftOnline
      ? "在线"
      : "离线";

  useEffect(() => {
    if (
      draft.selectedDeviceId &&
      !props.savedDevices.some((device) => device.id === draft.selectedDeviceId)
    ) {
      setDraft(createEmptyRelayDraft());
    }
  }, [draft.selectedDeviceId, props.savedDevices]);

  useEffect(() => {
    if (props.savedDevices.length === 0) {
      setRelayPairMode(true);
      return;
    }
    if (draftSavedDevice) {
      setRelayPairMode(false);
    }
  }, [draftSavedDevice, props.savedDevices.length]);

  useEffect(() => {
    if (!relayPairMode && !draftSavedDevice && relaySelectedDevice) {
      setDraft({
        selectedDeviceId: relaySelectedDevice.id,
        name: relaySelectedDevice.name
      });
    }
  }, [draftSavedDevice, relayPairMode, relaySelectedDevice]);

  function resetRelayPairing(options?: { keepCode?: boolean }) {
    if (!options?.keepCode) {
      setRelayPairCode("");
    }
    setRelayPairRequest(null);
    setRelayPairStatus("idle");
    setRelayPairMessage(null);
  }

  async function lookupRelayPairing() {
    if (!relayUrl) {
      setRelayPairStatus("error");
      setRelayPairMessage("当前 relay 地址不可用。");
      return;
    }
    const normalizedCode = normalizeRelayPairCode(relayPairCode);
    if (normalizedCode.length !== 6) {
      setRelayPairStatus("error");
      setRelayPairMessage("请输入 6 位配对码。");
      return;
    }
    setRelayPairStatus("loading");
    setRelayPairMessage(null);
    try {
      const request = await getRelayPairingRequest(relayUrl, normalizedCode);
      setRelayPairRequest(request);
      if (request.status === "pending") {
        setRelayPairStatus("ready");
        return;
      }
      if (request.status === "approved") {
        setRelayPairStatus("waiting");
        setRelayPairMessage("这个配对码已经批准，等待设备完成接入…");
        return;
      }
      setRelayPairStatus("error");
      setRelayPairMessage("这个配对码已失效，请在设备上重新运行配对命令。");
    } catch (error) {
      setRelayPairRequest(null);
      setRelayPairStatus("error");
      setRelayPairMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function approveRelayPairing() {
    if (!relayUrl || !relayAccessToken || !relayPairRequest) {
      setRelayPairStatus("error");
      setRelayPairMessage("当前浏览器还没有可用的 relay 会话。");
      return;
    }
    setRelayPairStatus("approving");
    setRelayPairMessage(null);
    try {
      const payload = await approveRelayPairingRequest(
        relayUrl,
        relayPairCode,
        relayAccessToken
      );
      setRelayPairRequest((previous) =>
        previous ? { ...previous, status: "approved" } : previous
      );
      setRelayPairStatus("waiting");
      setRelayPairMessage("已批准，等待这台设备完成接入…");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(1500);
        const devices = await props.onRefreshRelayDevices();
        const matched = devices.find((device) => device.deviceId === payload.deviceId);
        if (!matched) {
          continue;
        }
        setDraft({
          selectedDeviceId: matched.id,
          name: matched.name
        });
        setRelayPairMode(false);
        resetRelayPairing();
        return;
      }
      setRelayPairMessage("已批准。设备接入后会自动出现在左侧列表里。");
    } catch (error) {
      setRelayPairStatus("error");
      setRelayPairMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function isSavedDeviceOnline(device: SavedDevice): boolean {
    const presence = props.devicePresence[device.id];
    const connection = connectionFromSavedDevice(
      device,
      props.relayConnectionInfo?.accessToken ?? null
    );
    return Boolean(
      presence?.status === "online" ||
        (props.connected && connection && isSameAgentConnection(connection, props.connection))
    );
  }

  return (
    <div className="cn-overlay-panel device cn-live-overlay">
      <div
        className={
          relayPairingVisible
            ? "cn-sheet-card cn-live-sheet cn-device-sheet pairing"
            : "cn-sheet-card cn-live-sheet cn-device-sheet"
        }
      >
        <div className="cn-device-sheet-header">
          <div className="cn-device-sheet-copy">
            <span className="cn-device-sheet-kicker">设备桥接</span>
            <h2>连接设备</h2>
            <p>{relayPairingVisible ? "通过 Relay 接入新的 Codex 运行环境" : deviceSummaryLabel}</p>
          </div>
          <div className="cn-device-sheet-header-actions">
            <div
              className={
                draftOnline && !relayPairingVisible
                  ? "cn-device-sheet-state online"
                  : "cn-device-sheet-state"
              }
            >
              <span />
              <strong>{headerStatusLabel}</strong>
            </div>
            <button className="cn-close-button" type="button" onClick={props.onClose}>
              <CodexIcon name="x" />
            </button>
          </div>
        </div>

        <div className="cn-device-manager">
          <section className="cn-device-library" aria-label="已接入设备">
            <div className="cn-device-library-header">
              <div>
                <strong>设备</strong>
                <span>{deviceSummaryLabel}</span>
              </div>
              <button
                className="cn-add-mini-button"
                type="button"
                onClick={() => {
                  setRelayPairMode(true);
                  setDraft(createEmptyRelayDraft());
                  resetRelayPairing();
                }}
              >
                <CodexIcon name="plus" />
                接入
              </button>
            </div>

            {props.migrationNotice ? (
              <div className="cn-device-migration-notice" role="status">
                <span>{props.migrationNotice}</span>
                <button type="button" onClick={props.onDismissMigrationNotice}>
                  知道了
                </button>
              </div>
            ) : null}

            <div className="cn-saved-device-list">
              {props.savedDevices.length === 0 ? (
                <div className="cn-empty-device-list">
                  <CodexIcon name="terminal" />
                  <strong>没有已接入设备</strong>
                  <span>运行配对命令后输入 6 位码。</span>
                </div>
              ) : null}
              {props.savedDevices.map((device) => {
                const selected = draft.selectedDeviceId === device.id && !relayPairMode;
                const online = isSavedDeviceOnline(device);
                return (
                  <article
                    key={device.id}
                    className={[
                      "cn-saved-device-card",
                      selected ? "selected" : "",
                      online ? "online" : "offline"
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      className="cn-saved-device-main"
                      type="button"
                      onClick={() => {
                        setRelayPairMode(false);
                        resetRelayPairing();
                        setDraft({
                          selectedDeviceId: device.id,
                          name: device.name
                        });
                      }}
                      title={`${device.name} · ${savedDeviceAddressLabel(device)}`}
                    >
                      <span className={online ? "online" : ""} />
                      <div className="cn-saved-device-copy">
                        <strong>{device.name}</strong>
                        <small>{savedDeviceAddressLabel(device)}</small>
                      </div>
                      <em>{online ? "在线" : "离线"}</em>
                    </button>
                    <button
                      className="cn-device-delete-button"
                      type="button"
                      onClick={() => {
                        props.onDeleteDevice(device.id);
                        if (draft.selectedDeviceId === device.id) {
                          setDraft(createEmptyRelayDraft());
                        }
                      }}
                      aria-label={`移除设备 ${device.name}`}
                    >
                      移除
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="cn-device-editor" aria-label="当前设备">
            {relayPairingVisible ? (
              <div className="cn-relay-pair-card">
                <div className="cn-device-preview-header relay">
                  <div className="cn-device-preview-title relay-only">
                    <CodexIcon name="terminal" />
                    <div>
                      <strong>接入新设备</strong>
                      <small>{relayUrl ? `Relay ${relayUrl}` : "当前 relay 地址不可用"}</small>
                    </div>
                  </div>
                  <span className="cn-device-preview-pill">Relay</span>
                </div>
                <div className="cn-relay-pair-flow">
                  <div className="cn-relay-pair-step">
                    <span>1</span>
                    <div>
                      <strong>在目标设备上运行</strong>
                      <code>{relayPairCommand || "codexnext pair --relay <relay-url>"}</code>
                    </div>
                  </div>
                  <div className="cn-relay-pair-step">
                    <span>2</span>
                    <div>
                      <strong>输入 6 位配对码</strong>
                      <div className="cn-relay-pair-code-row">
                        <input
                          value={pairCodeValue}
                          onChange={(event) => {
                            setRelayPairCode(normalizeRelayPairCode(event.target.value));
                            setRelayPairStatus("idle");
                            setRelayPairMessage(null);
                          }}
                          inputMode="numeric"
                          placeholder="123-456"
                          aria-label="配对码"
                        />
                        <button
                          className="cn-secondary-button"
                          type="button"
                          disabled={relayPairStatus === "loading"}
                          onClick={() => void lookupRelayPairing()}
                        >
                          {relayPairStatus === "loading" ? "查找中" : "查找配对码"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {relayPairMessage ? (
                  <p
                    className={
                      relayPairStatus === "error"
                        ? "cn-relay-pair-error"
                        : "cn-relay-pair-hint"
                    }
                    role={relayPairStatus === "error" ? "alert" : "status"}
                  >
                    {relayPairMessage}
                  </p>
                ) : null}
                {relayPairRequest ? (
                  <div className="cn-relay-pair-request-card">
                    <div className="cn-relay-pair-request-title">
                      <strong>待接入设备</strong>
                      <span>{pairingStatusLabel(relayPairRequest.status)}</span>
                    </div>
                    <div>
                      <span>设备</span>
                      <strong>{relayPairRequest.deviceName}</strong>
                    </div>
                    <div>
                      <span>主机</span>
                      <strong>{relayPairRequest.hostname}</strong>
                    </div>
                    <div>
                      <span>平台</span>
                      <strong>
                        {relayPairRequest.platform} · {relayPairRequest.arch}
                      </strong>
                    </div>
                    <div>
                      <span>指纹</span>
                      <strong>{relayPairRequest.shortFingerprint}</strong>
                    </div>
                    <div>
                      <span>状态</span>
                      <strong>{pairingStatusLabel(relayPairRequest.status)}</strong>
                    </div>
                    <small>{pairingExpiryLabel(relayPairRequest)}</small>
                  </div>
                ) : null}
                <div className="cn-device-actions cn-sheet-actions cn-device-sheet-actions sticky">
                  <button
                    className="cn-secondary-button"
                    type="button"
                    onClick={() => {
                      setRelayPairMode(false);
                      resetRelayPairing();
                    }}
                  >
                    返回列表
                  </button>
                  <button
                    className="cn-primary-button"
                    type="button"
                    disabled={relayPairStatus !== "ready"}
                    onClick={() => void approveRelayPairing()}
                  >
                    允许这台设备接入
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="cn-device-preview-header">
                  <div className="cn-device-preview-title">
                    <CodexIcon name="terminal" />
                    <div>
                      <strong>{draftDisplayName}</strong>
                      <small>
                        {relaySelectedDevice
                          ? savedDeviceAddressLabel(relaySelectedDevice)
                          : "未选择设备"}
                      </small>
                    </div>
                  </div>
                  <span
                    className={
                      draftOnline ? "cn-device-preview-pill online" : "cn-device-preview-pill"
                    }
                  >
                    {draftOnline ? "在线" : "离线"}
                  </span>
                </div>

                <div className="cn-device-form-fields">
                  <label className="cn-field">
                    <span>设备名称</span>
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((previous) => ({ ...previous, name: event.target.value }))
                      }
                      placeholder="给这台设备起个名字"
                    />
                  </label>

                  <label className="cn-field readonly cn-device-field-url">
                    <span>地址</span>
                    <input
                      value={relaySelectedDevice ? savedDeviceAddressLabel(relaySelectedDevice) : ""}
                      readOnly
                    />
                  </label>
                </div>

                <div className="cn-device-status-grid">
                  <div>
                    <span>连接状态</span>
                    <strong>
                      {props.connected && draftConnected
                        ? "已连接"
                        : connectionStatusLabel(props.streamStatus)}
                    </strong>
                  </div>
                  <div>
                    <span>Codex</span>
                    <strong>{draftPresence?.codexVersion ?? props.healthStatus?.codex?.version ?? "unknown"}</strong>
                  </div>
                </div>

                <div className="cn-device-actions cn-sheet-actions cn-device-sheet-actions sticky">
                  <button className="cn-secondary-button" type="button" onClick={props.onClose}>
                    取消
                  </button>
                  <button
                    className="cn-primary-button"
                    type="button"
                    disabled={!relaySelectedDevice || !relayAccessToken}
                    onClick={() => {
                      if (!relaySelectedDevice || !relayAccessToken) {
                        return;
                      }
                      setDraft((previous) => ({
                        ...previous,
                        name: previous.name.trim() || relaySelectedDevice.name
                      }));
                      const nextConnection = connectionFromSavedDevice(
                        relaySelectedDevice,
                        relayAccessToken
                      );
                      if (!nextConnection) {
                        return;
                      }
                      void props.onConnect(
                        nextConnection,
                        draft.name.trim() || relaySelectedDevice.name,
                        relaySelectedDevice.id
                      );
                    }}
                  >
                    {draftConnected ? "重新连接" : "连接"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function createActiveDeviceDraft(params: {
  connection: AgentConnection;
  deviceName: string;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
}): DeviceDraftState {
  const selectedDevice = params.selectedDeviceId
    ? params.savedDevices.find((device) => device.id === params.selectedDeviceId) ?? null
    : null;
  const matchedDevice = selectedDevice ?? findSavedDevice(params.savedDevices, params.connection);
  if (matchedDevice) {
    return {
      selectedDeviceId: matchedDevice.id,
      name: matchedDevice.name
    };
  }
  return {
    selectedDeviceId: null,
    name: params.deviceName || "CodexNext relay"
  };
}

function createEmptyRelayDraft(): DeviceDraftState {
  return {
    selectedDeviceId: null,
    name: ""
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pairingStatusLabel(status: PairingRequestView["status"]): string {
  switch (status) {
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
    default:
      return "等待批准";
  }
}

function pairingExpiryLabel(request: PairingRequestView): string {
  return `有效期至 ${new Date(request.expiresAt).toLocaleString()}`;
}

function connectionStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "connected":
    case "online":
      return "已连接";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "disconnected":
    case "offline":
      return "未连接";
    case "error":
      return "异常";
    default:
      return status;
  }
}
