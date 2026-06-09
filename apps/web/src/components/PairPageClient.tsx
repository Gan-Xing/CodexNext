"use client";

import { useEffect, useState } from "react";
import type {
  PairingApproveResponse,
  PairingRequestView
} from "@codexnext/protocol";
import { requestRelaySession, resolveDefaultRelayUrl } from "../lib/relay";

type PairPageState =
  | { status: "loading" }
  | { status: "ready"; request: PairingRequestView }
  | { status: "approving"; request: PairingRequestView }
  | { status: "done"; request: PairingRequestView }
  | { status: "error"; message: string };

export function PairPageClient(props: { code: string; initialRelayUrl: string }) {
  const [state, setState] = useState<PairPageState>({ status: "loading" });
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [targetRelayUrl, setTargetRelayUrl] = useState(
    props.initialRelayUrl || resolveDefaultRelayUrl()
  );

  useEffect(() => {
    let cancelled = false;
    void requestRelaySession()
      .then((session) => {
        if (cancelled || !session) {
          return;
        }
        setSessionToken(session.sessionToken);
        setTargetRelayUrl(session.relayUrl);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!props.code) {
      setState({ status: "error", message: "缺少配对码。" });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          new URL(
            `/api/pairings/requests/${encodeURIComponent(props.code)}`,
            targetRelayUrl
          )
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "配对请求不存在。");
        }
        const request = (await response.json()) as PairingRequestView;
        if (!cancelled) {
          setState({ status: "ready", request });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.code, targetRelayUrl]);

  async function approve() {
    if (state.status !== "ready" || !sessionToken) {
      return;
    }
    setState({ status: "approving", request: state.request });
    try {
      const response = await fetch(
        new URL(
          `/api/pairings/requests/${encodeURIComponent(props.code)}/approve`,
          targetRelayUrl
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken}`
          }
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "配对失败。");
      }
      const payload = (await response.json()) as PairingApproveResponse;
      setState({ status: "done", request: state.request });
      window.location.href = `/?deviceId=${encodeURIComponent(payload.deviceId)}`;
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function reject() {
    if (state.status !== "ready" || !sessionToken) {
      return;
    }
    setState({ status: "approving", request: state.request });
    try {
      const response = await fetch(
        new URL(
          `/api/pairings/requests/${encodeURIComponent(props.code)}/reject`,
          targetRelayUrl
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken}`
          }
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "拒绝失败。");
      }
      window.location.href = "/";
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return (
    <main className="cn-pair-page">
      <section className="cn-pair-card">
        <span className="cn-pair-kicker">CodexNext Pair</span>
        <h1>配对这台设备</h1>
        <PairShellMessage state={state} />
        {"request" in state && state.request ? (
          <div className="cn-pair-meta">
            <div>
              <span>设备</span>
              <strong>{state.request.deviceName}</strong>
            </div>
            <div>
              <span>主机</span>
              <strong>{state.request.hostname}</strong>
            </div>
            <div>
              <span>平台</span>
              <strong>
                {state.request.platform} · {state.request.arch}
              </strong>
            </div>
            <div>
              <span>指纹</span>
              <strong>{state.request.shortFingerprint}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong>{statusLabel(state.request.status)}</strong>
            </div>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <div className="cn-pair-actions">
            <button className="cn-secondary-button" type="button" onClick={() => void reject()}>
              拒绝
            </button>
            <button className="cn-login-submit" type="button" onClick={() => void approve()}>
              允许这台设备接入
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PairShellMessage(props: { state: PairPageState }) {
  if (props.state.status === "loading") {
    return <p>正在读取配对请求…</p>;
  }
  if (props.state.status === "approving") {
    return <p>正在处理…</p>;
  }
  if (props.state.status === "done") {
    return <p>已授权，正在进入控制台…</p>;
  }
  if (props.state.status === "error") {
    return <p className="cn-pair-error">{props.state.message}</p>;
  }
  return null;
}

function statusLabel(status: PairingRequestView["status"]): string {
  switch (status) {
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
    default:
      return "待批准";
  }
}
