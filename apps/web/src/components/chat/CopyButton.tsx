"use client";

import { useState } from "react";
import { copyText } from "../../lib/copy-text";

export function CopyButton(props: {
  className?: string;
  label?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const success = await copyText(props.value);
    if (!success) {
      setCopied(false);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
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
