"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginPageBody />
    </Suspense>
  );
}

function LoginPageBody() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "登录失败。");
      }
      window.location.href = nextPath;
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LoginShell
      error={error}
      password={password}
      submitting={submitting}
      onChange={setPassword}
      onSubmit={submit}
    />
  );
}

function LoginShell(props?: {
  error?: string | null;
  password?: string;
  submitting?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <main className="cn-login-page">
      <section className="cn-login-card">
        <span className="cn-login-kicker">CodexNext</span>
        <h1>登录控制台</h1>
        <p>先完成登录，再进入 relay 控制平面。</p>
        <label className="cn-login-field">
          <span>访问口令</span>
          <input
            autoComplete="current-password"
            type="password"
            value={props?.password ?? ""}
            onChange={(event) => props?.onChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && props?.password?.trim()) {
                void props.onSubmit?.();
              }
            }}
          />
        </label>
        {props?.error ? <p className="cn-login-error">{props.error}</p> : null}
        <button
          className="cn-login-submit"
          type="button"
          disabled={!props?.password?.trim() || props?.submitting}
          onClick={() => void props?.onSubmit?.()}
        >
          {props?.submitting ? "登录中…" : "登录"}
        </button>
      </section>
    </main>
  );
}
