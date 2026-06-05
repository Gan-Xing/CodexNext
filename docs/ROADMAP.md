# Roadmap

## Phase 1: Local Codex app-server Smoke Test

Status: implemented in this repository.

Goals:

- pnpm TypeScript monorepo
- `@codexnext/protocol`
- `@codexnext/codex-client`
- `@codexnext/agent`
- `codexnext doctor`
- `codexnext goal-smoke`
- tests for JSON-RPC core behavior
- docs and first ADR

## Phase 2: Local Web Console

Do not start until explicitly requested.

Target:

- local browser UI
- local agent HTTP or WebSocket endpoint
- project path input
- Goal input
- model input
- live event stream
- visible approval dialog

## Phase 3: Control Server

Target:

- NestJS control server
- outbound device connection
- user and device models
- project allowlist
- session event persistence

## Phase 4: Mobile Client

Target:

- Expo React Native
- device/session list
- create thread
- set Goal
- steer or interrupt active turns
- approval prompts

## Phase 5: Multi-device Reliability

Target:

- pairing
- reconnect behavior
- event replay
- local daemon mode
- machine/session layering

