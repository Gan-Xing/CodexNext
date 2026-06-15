import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

function parseAllowedOriginHost(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  }
}

function readTailscaleHosts() {
  try {
    const output = execSync("tailscale status --json", {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString("utf8");
    const status = JSON.parse(output);
    const hosts = new Set();

    for (const ip of status?.Self?.TailscaleIPs ?? []) {
      if (typeof ip === "string" && ip.trim()) {
        hosts.add(ip.trim());
      }
    }

    if (typeof status?.Self?.DNSName === "string" && status.Self.DNSName.trim()) {
      hosts.add(status.Self.DNSName.trim().replace(/\.$/, ""));
    }

    return [...hosts];
  } catch {
    try {
      return execSync("tailscale ip -4", {
        stdio: ["ignore", "pipe", "ignore"]
      })
        .toString("utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

function resolveAllowedDevOrigins() {
  const hosts = new Set(["127.0.0.1", "localhost"]);

  for (const host of readTailscaleHosts()) {
    hosts.add(host);
  }

  for (const item of (process.env.CODEXNEXT_ALLOWED_DEV_ORIGINS ?? "").split(",")) {
    const host = parseAllowedOriginHost(item);
    if (host) {
      hosts.add(host);
    }
  }

  return [...hosts];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: resolveAllowedDevOrigins(),
  devIndicators: false,
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;
