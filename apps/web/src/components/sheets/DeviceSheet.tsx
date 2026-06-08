"use client";

import { useEffect, useState } from "react";
import type { AgentConnection } from "../../lib/api";
import {
  approveRelayPairingRequest,
  formatRelayPairCode,
  getRelayPairingRequest,
  normalizeRelayPairCode
} from "../../lib/relay";
import type {
  LocalHealthResponse,
  PairingRequestView
} from "../../lib/types";
import {
  connectionFromSavedDevice,
  defaultDeviceName,
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
  relayConnectionInfo: { accessToken: string; relayUrl: string } | null;
  relayEnabled: boolean;
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
  const [relayPairMode, setRelayPairMode] = useState(
    props.relayEnabled && !props.savedDevices.some((device) => device.mode === "relay")
  );
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
      isSameAgentConnection(connectionFromSavedDevice(draftSavedDevice), props.connection)
  );
  const draftOnline = draftConnected || draftPresence?.status === "online";
  const draftDisplayName = draft.name.trim() || draftSavedDevice?.name || "新设备";
  const relayDevices = props.savedDevices.filter((device) => device.mode === "relay");
  const relaySelectedDevice =
    draftSavedDevice?.mode === "relay" ? draftSavedDevice : relayDevices[0] ?? null;
  const waitingForRelayDevice = props.relayEnabled && relayDevices.length === 0;
  const relayUrl =
    props.relayConnectionInfo?.relayUrl ??
    (relaySelectedDevice?.mode === "relay" ? relaySelectedDevice.relayUrl : null);
  const relayAccessToken =
    props.relayConnectionInfo?.accessToken ??
    (relaySelectedDevice?.mode === "relay" ? relaySelectedDevice.ownerToken : null);
  const pairCodeValue = formatRelayPairCode(relayPairCode);
  const relayPairingVisible = props.relayEnabled && (relayPairMode || waitingForRelayDevice);
  const relayPairCommand = relayUrl ? `codexnext pair --relay ${relayUrl}` : "";

  useEffect(() => {
    if (
      draft.selectedDeviceId &&
      !props.savedDevices.some((device) => device.id === draft.selectedDeviceId)
    ) {
      setDraft(props.relayEnabled ? createEmptyRelayDraft() : createEmptyDeviceDraft());
    }
  }, [draft.selectedDeviceId, props.relayEnabled, props.savedDevices]);

  useEffect(() => {
    if (props.relayEnabled && relayDevices.length === 0) {
      setRelayPairMode(true);
      return;
    }
    if (relayDevices.length > 0 && draftSavedDevice?.mode === "relay") {
      setRelayPairMode(false);
    }
  }, [draftSavedDevice?.mode, props.relayEnabled, relayDevices.length]);

  useEffect(() => {
    if (props.relayEnabled && !relayPairMode && !draftSavedDevice && relaySelectedDevice) {
      setDraft({
        selectedDeviceId: relaySelectedDevice.id,
        name: relaySelectedDevice.name,
        mode: "relay",
        agentUrl: "",
        token: ""
      });
    }
  }, [draftSavedDevice, props.relayEnabled, relayPairMode, relaySelectedDevice]);

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
      setRelayPairStatus("ready");
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
      setRelayPairStatus("waiting");
      setRelayPairMessage("已批准，等待这台设备完成接入…");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(1500);
        const devices = await props.onRefreshRelayDevices();
        const matched = devices.find(
          (device) =>
            device.mode === "relay" && device.deviceId === payload.deviceId
        );
        if (!matched) {
          continue;
        }
        setDraft({
          selectedDeviceId: matched.id,
          name: matched.name,
          mode: "relay",
          agentUrl: "",
          token: ""
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

  return (
    <div className="cn-overlay-panel device cn-live-overlay">
      <div className="cn-sheet-card cn-live-sheet cn-device-sheet">
        <div className="cn-device-sheet-header">
          <div className="cn-device-sheet-copy">
            <h2>连接设备</h2>
          </div>
          <button className="cn-close-button" type="button" onClick={props.onClose}>
            <CodexIcon name="x" />
          </button>
        </div>

        <div className="cn-device-manager">
          <section className="cn-device-library" aria-label="已保存设备">
            <div className="cn-device-library-header">
              <strong>设备</strong>
              <button
                className="cn-add-mini-button"
                type="button"
                onClick={() => {
                  if (props.relayEnabled) {
                    setRelayPairMode(true);
                    setDraft(createEmptyRelayDraft());
                    resetRelayPairing();
                    return;
                  }
                  setDraft(createEmptyDeviceDraft());
                }}
              >
                <CodexIcon name="plus" />
                {props.relayEnabled ? "接入" : "新增"}
              </button>
            </div>

            <div className="cn-saved-device-list">
              {props.savedDevices.length === 0 ? (
                <div className="cn-empty-device-list">
                  {props.relayEnabled ? "还没有设备，先接入一台。" : "还没有设备"}
                </div>
              ) : null}
              {props.savedDevices.map((device) => {
                const selected = draft.selectedDeviceId === device.id && !relayPairMode;
                const presence = props.devicePresence[device.id];
                const online =
                  presence?.status === "online" ||
                  (props.connected &&
                    isSameAgentConnection(connectionFromSavedDevice(device), props.connection));
                return (
                  <article
                    key={device.id}
                    className={
                      selected
                        ? "cn-saved-device-card selected"
                        : "cn-saved-device-card"
                    }
                  >
                    <button
                      className="cn-saved-device-main"
                      type="button"
                      onClick={() => {
                        setRelayPairMode(false);
                        resetRelayPairing();
                        setDraft({
                          selectedDeviceId: device.id,
                          name: device.name,
                          mode: device.mode,
                          agentUrl: device.mode === "direct" ? device.agentUrl : "",
                          token: device.mode === "direct" ? device.token : ""
                        });
                      }}
                      title={`${device.name} · ${savedDeviceAddressLabel(device)}`}
                    >
                      <span className={online ? "online" : ""} />
                      <strong>{device.name}</strong>
                      <small>{savedDeviceAddressLabel(device)}</small>
                    </button>
                    <button
                      className="cn-device-delete-button"
                      type="button"
                      onClick={() => {
                        props.onDeleteDevice(device.id);
                        if (draft.selectedDeviceId === device.id) {
                          setDraft(props.relayEnabled ? createEmptyRelayDraft() : createEmptyDeviceDraft());
                        }
                      }}
                      aria-label={`删除设备 ${device.name}`}
                    >
                      删除
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="cn-device-editor" aria-label="设备连接设置">
            <div className="cn-device-editor-top">
              <div
                className={
                  draftOnline ? "cn-real-device-row online" : "cn-real-device-row"
                }
              >
                <CodexIcon name="terminal" />
                <span className={draftOnline ? "cn-live-dot" : "cn-live-dot offline"} />
                <div>
                  <strong>{draftDisplayName}</strong>
                  <small>
                    {draftSavedDevice
                      ? savedDeviceAddressLabel(draftSavedDevice)
                      : relayPairingVisible
                        ? "通过配对码接入 relay"
                        : draft.agentUrl}
                  </small>
                </div>
              </div>
            </div>

            {relayPairingVisible ? (
              <>
                <div className="cn-device-pair-card">
                  <div className="cn-device-pair-copy">
                    <strong>接入新设备</strong>
                    <p>在另一台设备上运行下面命令。拿到 6 位配对码后，在这里批准。</p>
                  </div>
                  <label className="cn-device-field">
                    Relay
                    <input
                      name="device_relay_url"
                      value={relayUrl ?? ""}
                      disabled
                      placeholder="http://100.100.115.100:3922"
                    />
                  </label>
                  <div className="cn-device-command-block">
                    <code>{relayPairCommand || "等待 relay 地址…"}</code>
                  </div>
                  <div className="cn-device-form-fields cn-device-pair-fields">
                    <label className="cn-device-field cn-device-field-code">
                      配对码
                      <input
                        name="device_pair_code"
                        value={pairCodeValue}
                        onChange={(event) => {
                          setRelayPairCode(event.target.value);
                          if (relayPairStatus === "error") {
                            setRelayPairStatus("idle");
                            setRelayPairMessage(null);
                          }
                        }}
                        placeholder="123-456"
                      />
                    </label>
                    <button
                      className="cn-soft-button cn-device-pair-button"
                      type="button"
                      onClick={() => void lookupRelayPairing()}
                      disabled={!relayUrl || relayPairStatus === "loading" || relayPairStatus === "approving"}
                    >
                      {relayPairStatus === "loading" ? "查询中…" : "查找配对码"}
                    </button>
                  </div>
                  {relayPairRequest ? (
                    <div className="cn-device-pair-request">
                      <strong>{relayPairRequest.deviceName}</strong>
                      <small>
                        {relayPairRequest.hostname} · {relayPairRequest.platform} ·{" "}
                        {relayPairRequest.arch}
                      </small>
                      <small>
                        {relayPairRequest.codexVersion ?? relayPairRequest.agentVersion}
                      </small>
                    </div>
                  ) : null}
                  {relayPairMessage ? (
                    <div
                      className={
                        relayPairStatus === "error"
                          ? "cn-live-error inline"
                          : "cn-device-pair-message"
                      }
                    >
                      {relayPairStatus === "error" ? (
                        <>
                          <strong>配对失败</strong>
                          <span>{relayPairMessage}</span>
                        </>
                      ) : (
                        relayPairMessage
                      )}
                    </div>
                  ) : null}
                  {relayPairRequest?.status === "pending" ? (
                    <button
                      className="cn-primary-button cn-device-pair-approve"
                      type="button"
                      onClick={() => void approveRelayPairing()}
                      disabled={!relayAccessToken || relayPairStatus === "approving"}
                    >
                      {relayPairStatus === "approving" ? "正在批准…" : "允许这台设备接入"}
                    </button>
                  ) : null}
                </div>

                <details className="cn-device-advanced">
                  <summary>Advanced</summary>
                  <div className="cn-device-advanced-copy">
                    Direct endpoint 仅用于本地开发模式。
                  </div>
                  <button
                    className="cn-soft-button"
                    type="button"
                    onClick={() => {
                      setRelayPairMode(false);
                      setDraft(createEmptyDeviceDraft());
                    }}
                  >
                    添加 direct endpoint
                  </button>
                </details>
              </>
            ) : draftSavedDevice?.mode === "relay" ? (
              <div className="cn-device-form-fields">
                <label className="cn-device-field cn-device-field-name">
                  设备名称
                  <input
                    name="device_name"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        name: event.target.value
                      }))
                    }
                    placeholder="MacBook"
                  />
                </label>
                <label className="cn-device-field">
                  Relay
                  <input name="device_relay_url" value={draftSavedDevice.relayUrl} disabled />
                </label>
              </div>
            ) : (
              <>
                <div className="cn-device-form-fields">
                  <label className="cn-device-field cn-device-field-name">
                    设备名称
                    <input
                      name="device_name"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          name: event.target.value
                        }))
                      }
                      placeholder="Macmini"
                    />
                  </label>
                  <label className="cn-device-field cn-device-field-url">
                    地址
                    <input
                      name="device_agent_url"
                      value={draft.agentUrl}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          agentUrl: event.target.value,
                          mode: "direct",
                          selectedDeviceId: null
                        }))
                      }
                      placeholder="http://127.0.0.1:17361"
                    />
                  </label>
                  <label className="cn-device-field cn-device-field-token">
                    Token
                    <input
                      name="device_access_token"
                      value={draft.token}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          mode: "direct",
                          selectedDeviceId: null,
                          token: event.target.value
                        }))
                      }
                      placeholder="token"
                    />
                  </label>
                </div>

                {props.relayEnabled ? (
                  <details className="cn-device-advanced">
                    <summary>Advanced</summary>
                    <div className="cn-device-advanced-copy">
                      当前页面优先使用 relay。这里只保留 direct endpoint 调试入口。
                    </div>
                  </details>
                ) : null}
              </>
            )}

            <div className="cn-sheet-actions cn-device-sheet-actions">
              <button className="cn-soft-button" type="button" onClick={props.onClose}>
                取消
              </button>
              {relayPairingVisible ? (
                relayDevices.length > 0 ? (
                  <button
                    className="cn-primary-button"
                    type="button"
                    onClick={() => {
                      setRelayPairMode(false);
                      resetRelayPairing();
                    }}
                  >
                    返回设备列表
                  </button>
                ) : null
              ) : (
                <button
                  className="cn-primary-button"
                  type="button"
                  onClick={() =>
                    void props.onConnect(
                      draftSavedDevice
                        ? connectionFromSavedDevice(draftSavedDevice)
                        : { mode: "direct", agentUrl: draft.agentUrl, token: draft.token },
                      draft.name,
                      draft.selectedDeviceId
                    )
                  }
                >
                  {draftConnected ? "重连" : "连接"}
                </button>
              )}
            </div>
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
    ? params.savedDevices.find((device) => device.id === params.selectedDeviceId) ??
      null
    : null;
  const matchedDevice =
    selectedDevice ??
    findSavedDevice(params.savedDevices, params.connection);
  if (matchedDevice) {
    return {
      selectedDeviceId: matchedDevice.id,
      name: matchedDevice.name,
      mode: matchedDevice.mode,
      agentUrl: matchedDevice.mode === "direct" ? matchedDevice.agentUrl : "",
      token: matchedDevice.mode === "direct" ? matchedDevice.token : ""
    };
  }
  return {
    selectedDeviceId: null,
    mode: params.connection.mode,
    name:
      params.deviceName ||
      (params.connection.mode === "direct"
        ? defaultDeviceName(params.connection.agentUrl)
        : "CodexNext relay"),
    agentUrl: params.connection.mode === "direct" ? params.connection.agentUrl : "",
    token: params.connection.mode === "direct" ? params.connection.token : ""
  };
}

function createEmptyDeviceDraft(): DeviceDraftState {
  return {
    selectedDeviceId: null,
    mode: "direct",
    name: "",
    agentUrl: "http://127.0.0.1:17361",
    token: "test-token"
  };
}

function createEmptyRelayDraft(): DeviceDraftState {
  return {
    selectedDeviceId: null,
    mode: "relay",
    name: "CodexNext relay",
    agentUrl: "",
    token: ""
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}
