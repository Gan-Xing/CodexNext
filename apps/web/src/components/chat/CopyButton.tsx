"use client";

import { useState } from "react";

export function CopyButton(props: {
  className?: string;
  label?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className={props.className ?? "cn-copy-button"}
      type="button"
      onClick={() => void copy()}
    >
      {copied ? "已复制" : props.label ?? "复制"}
    </button>
  );
}
