"use client";

import { useState } from "react";
import { copyText } from "../../lib/copy-text";
import { CodexIcon } from "../DesignLab";

export function MessageCopyButton(props: {
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const success = await copyText(props.value);
    if (!success) {
      setCopied(false);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  }

  return (
    <button
      className={copied ? "cn-message-copy-button copied" : "cn-message-copy-button"}
      type="button"
      aria-label={copied ? "已复制" : "复制消息"}
      onClick={() => void handleCopy()}
    >
      <CodexIcon name={copied ? "check" : "copy"} />
    </button>
  );
}
