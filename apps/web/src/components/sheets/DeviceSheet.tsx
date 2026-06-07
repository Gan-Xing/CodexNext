"use client";

import { useEffect, useState } from "react";
import type { AgentConnection } from "../../lib/api";
import type { LocalHealthResponse } from "../../lib/types";
import {
  defaultDeviceName,
  findSavedDevice,
  isSameDeviceEndpoint,
  shortAgentUrl,
  type DeviceDraftState,
  type DevicePresenceState,
  type SavedDevice
} from "../../features/devices/device-utils";
import { CodexIcon } from "../DesignLab";

export function DeviceSheet(props: {
  agentUrl: string;
  connected: boolean;
  devicePresence: Record<string, DevicePresenceState>;
  deviceName: string;
  healthStatus: LocalHealthResponse | null;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
  streamStatus: string;
  token: string;
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
      agentUrl: props.agentUrl,
      deviceName: props.deviceName,
      savedDevices: props.savedDevices,
      selectedDeviceId: props.selectedDeviceId,
      token: props.token
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
      isSameDeviceEndpoint(
        {
          id: draft.selectedDeviceId,
          name: draft.name,
          agentUrl: draft.agentUrl,
          token: draft.token
        },
        props.agentUrl,
        props.token
      )
  );
  const draftOnline = draftConnected || draftPresence?.status === "online";
  const draftDisplayName = draft.name.trim() || draftSavedDevice?.name || "新设备";

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
                    isSameDeviceEndpoint(device, props.agentUrl, props.token));
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
                          agentUrl: device.agentUrl,
                          token: device.token
                        })
                      }
                      title={`${device.name} · ${device.agentUrl}`}
                    >
                      <span className={online ? "online" : ""} />
                      <strong>{device.name}</strong>
                      <small>{shortAgentUrl(device.agentUrl)}</small>
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
                  <small>{shortAgentUrl(draft.agentUrl)}</small>
                </div>
              </div>
            </div>

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
                      selectedDeviceId: null,
                      token: event.target.value
                    }))
                  }
                  placeholder="token"
                />
              </label>
            </div>

            <div className="cn-sheet-actions cn-device-sheet-actions">
              <button className="cn-soft-button" type="button" onClick={props.onClose}>
                取消
              </button>
              <button
                className="cn-primary-button"
                type="button"
                onClick={() =>
                  void props.onConnect(
                    { agentUrl: draft.agentUrl, token: draft.token },
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
  agentUrl: string;
  deviceName: string;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
  token: string;
}): DeviceDraftState {
  const selectedDevice = params.selectedDeviceId
    ? params.savedDevices.find((device) => device.id === params.selectedDeviceId) ??
      null
    : null;
  const matchedDevice =
    selectedDevice ??
    findSavedDevice(params.savedDevices, params.agentUrl, params.token);
  if (matchedDevice) {
    return {
      selectedDeviceId: matchedDevice.id,
      name: matchedDevice.name,
      agentUrl: matchedDevice.agentUrl,
      token: matchedDevice.token
    };
  }
  return {
    selectedDeviceId: null,
    name: params.deviceName || defaultDeviceName(params.agentUrl),
    agentUrl: params.agentUrl,
    token: params.token
  };
}

function createEmptyDeviceDraft(): DeviceDraftState {
  return {
    selectedDeviceId: null,
    name: "",
    agentUrl: "http://127.0.0.1:17361",
    token: "test-token"
  };
}
