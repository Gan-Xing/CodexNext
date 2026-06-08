"use client";

import { useEffect, useState } from "react";
import type { AgentConnection } from "../../lib/api";
import type { LocalHealthResponse } from "../../lib/types";
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

export function DeviceSheet(props: {
  connected: boolean;
  connection: AgentConnection;
  devicePresence: Record<string, DevicePresenceState>;
  deviceName: string;
  healthStatus: LocalHealthResponse | null;
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
}) {
  const [draft, setDraft] = useState<DeviceDraftState>(() =>
    createActiveDeviceDraft({
      connection: props.connection,
      deviceName: props.deviceName,
      savedDevices: props.savedDevices,
      selectedDeviceId: props.selectedDeviceId,
    })
  );

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

  useEffect(() => {
    if (
      draft.selectedDeviceId &&
      !props.savedDevices.some((device) => device.id === draft.selectedDeviceId)
    ) {
      setDraft(createEmptyDeviceDraft());
    }
  }, [draft.selectedDeviceId, props.savedDevices]);

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
                onClick={() => setDraft(createEmptyDeviceDraft())}
              >
                <CodexIcon name="plus" />
                新增
              </button>
            </div>

            <div className="cn-saved-device-list">
              {props.savedDevices.length === 0 ? (
                <div className="cn-empty-device-list">还没有设备</div>
              ) : null}
              {props.savedDevices.map((device) => {
                const selected = draft.selectedDeviceId === device.id;
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
                      onClick={() =>
                        setDraft({
                          selectedDeviceId: device.id,
                          name: device.name,
                          mode: device.mode,
                          agentUrl: device.mode === "direct" ? device.agentUrl : "",
                          token: device.mode === "direct" ? device.token : ""
                        })
                      }
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
                          setDraft(createEmptyDeviceDraft());
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
                    {draftSavedDevice ? savedDeviceAddressLabel(draftSavedDevice) : draft.agentUrl}
                  </small>
                </div>
              </div>
            </div>

            {draftSavedDevice?.mode === "relay" ? (
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
            )}

            {relayDevices.length > 0 ? (
              <details className="cn-device-advanced">
                <summary>Advanced</summary>
                <div className="cn-device-advanced-copy">
                  Direct endpoint 仅用于本地开发模式。
                </div>
                <button
                  className="cn-soft-button"
                  type="button"
                  onClick={() => setDraft(createEmptyDeviceDraft())}
                >
                  添加 direct endpoint
                </button>
              </details>
            ) : null}

            <div className="cn-sheet-actions cn-device-sheet-actions">
              <button className="cn-soft-button" type="button" onClick={props.onClose}>
                取消
              </button>
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
                {draftConnected
                  ? "重连"
                  : "连接"}
              </button>
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
    agentUrl: params.connection.mode === "direct" ? params.connection.agentUrl : "http://127.0.0.1:17361",
    token: params.connection.mode === "direct" ? params.connection.token : "test-token"
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
