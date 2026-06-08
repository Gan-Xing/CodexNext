"use client";

import { Suspense, type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  PairingApproveResponse,
  PairingRequestView
} from "@codexnext/protocol";
import {
  requestRelaySession,
  relayAccessTokenStorageKey,
  resolveDefaultRelayUrl
} from "../../lib/relay";

type PairPageState =
  | { status: "loading" }
  | { status: "ready"; request: PairingRequestView }
  | { status: "approving"; request: PairingRequestView }
  | { status: "done"; request: PairingRequestView }
  | { status: "error"; message: string };

export default function PairPage() {
  return (
    <Suspense fallback={<PairPageShell message="正在读取配对请求…" />}>
      <PairPageBody />
    </Suspense>
  );
}

function PairPageBody() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code")?.trim() ?? "";
  const initialRelayUrl =
    searchParams.get("relay")?.trim() || resolveDefaultRelayUrl();
  const [state, setState] = useState<PairPageState>({ status: "loading" });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [targetRelayUrl, setTargetRelayUrl] = useState(initialRelayUrl);

  useEffect(() => {
    const stored = window.localStorage.getItem(relayAccessTokenStorageKey);
    if (stored) {
      setAccessToken(stored);
    }
    let cancelled = false;
    void requestRelaySession()
      .then((session) => {
        if (cancelled || !session) {
          return;
        }
        window.localStorage.setItem(
          relayAccessTokenStorageKey,
          session.sessionToken
        );
        setAccessToken(session.sessionToken);
        setTargetRelayUrl(session.relayUrl);
      })
      .catch(() => {
        return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!code) {
      setState({ status: "error", message: "缺少配对码。" });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          new URL(
            `/api/pairings/requests/${encodeURIComponent(code)}`,
            targetRelayUrl
          )
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "配对请求不存在。");
        }
        const request = (await response.json()) as PairingRequestView;
        if (cancelled) {
          return;
        }
        setState({ status: "ready", request });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [code, targetRelayUrl]);

  const approve = async () => {
    if (state.status !== "ready") {
      return;
    }
    if (!accessToken) {
      setState({
        status: "error",
        message: "当前浏览器还没有控制台会话，请先打开主控制台。"
      });
      return;
    }
    setState({ status: "approving", request: state.request });
    try {
      const response = await fetch(
        new URL(
          `/api/pairings/requests/${encodeURIComponent(code)}/approve`,
          targetRelayUrl
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "配对失败。");
      }
      const payload = (await response.json()) as PairingApproveResponse;
      window.localStorage.setItem(
        relayAccessTokenStorageKey,
        payload.sessionToken
      );
      setState({ status: "done", request: state.request });
      window.location.href = `/?deviceId=${encodeURIComponent(payload.deviceId)}&relay=${encodeURIComponent(targetRelayUrl)}`;
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  return (
    <PairPageShell
      message={
        state.status === "loading"
          ? "正在读取配对请求…"
          : state.status === "approving"
            ? "正在授权…"
            : state.status === "done"
              ? "已授权，正在进入控制台…"
              : state.status === "error"
                ? state.message
                : state.status === "ready" && !accessToken
                  ? "请先打开主控制台建立当前浏览器会话，再回来批准这台设备。"
                : null
      }
      messageClassName={state.status === "error" ? "cn-pair-error" : undefined}
      request={"request" in state ? state.request : null}
      action={
        state.status === "ready" && accessToken ? (
          <button className="cn-pair-submit" type="button" onClick={approve}>
            允许这台设备接入
          </button>
        ) : null
      }
    />
  );
}

function PairPageShell(props: {
  action?: ReactNode | undefined;
  message?: string | null | undefined;
  messageClassName?: string | undefined;
  request?: PairingRequestView | null | undefined;
}) {
  return (
    <main className="cn-pair-page">
      <section className="cn-pair-card">
        <span className="cn-pair-kicker">CodexNext Pair</span>
        <h1>配对这台设备</h1>
        {props.message ? (
          <p className={props.messageClassName}>{props.message}</p>
        ) : null}
        {props.request ? (
          <div className="cn-pair-meta">
            <div>
              <span>设备</span>
              <strong>{props.request.deviceName}</strong>
            </div>
            <div>
              <span>主机</span>
              <strong>{props.request.hostname}</strong>
            </div>
            <div>
              <span>平台</span>
              <strong>
                {props.request.platform} · {props.request.arch}
              </strong>
            </div>
            <div>
              <span>状态</span>
              <strong>{statusLabel(props.request.status)}</strong>
            </div>
          </div>
        ) : null}
        {props.action}
      </section>
    </main>
  );
}

function statusLabel(status: PairingRequestView["status"]): string {
  switch (status) {
    case "approved":
      return "已批准";
    case "expired":
      return "已过期";
    default:
      return "待批准";
  }
}
