# Agent Note: Enterprise access-ticket transport canary

Status: implemented

[English](2026-08-13-enterprise-access-ticket-transport-canary.md) | 中文

## Problem

Web connection carrier 此前只有 Host 与 Origin 的可达性检查。它们可防御 DNS rebinding 与跨站浏览器流量，但无法为企业部署选择已经认证的 tenant、workspace、runtime generation 或浏览器 connection generation。

## Decision

**`@deepseek-ai/dsh-client-connection` 提供 opt-in 的 `accessTicket` Host 配置。** 配置接收纯 server-side 的 `AccessTicketVerifier`；它从 `x-dsh-access-ticket` 或 `__Host-dsh-access-ticket` 接收 opaque 值，并返回权威的 immutable binding。DSH 不解析 OAuth 或提供方凭据，不联系身份提供方，不记录 token，也不隐式开启 remote mode。省略配置会保留既有 local-only 行为。

**`dsh_web_v1` profile 在既有浏览器信任栅栏后只授权三个精确 carrier。** verifier 收到的 `/api` 为 `http`，`/api/events.mux` 为 `events.mux`，`/api/events.host` 为 `events.host`；没有通用 WebSocket path 被接受。已接受的 binding 包含 `sid`、`principal`、`tenant`、`workspace`、`runtimeRef`、`runtimeGeneration`、`connectionGeneration`、`audience`、精确 `origin`、`expiresAt` 和 `jti`。gate 会拒绝缺失、过期、格式错误、audience 不匹配、origin 不匹配和 verifier 拒绝的 binding。verifier 失败与普通拒绝没有可区分的对外差异。

**WebSocket pair 只有一个带 hard expiry 的 fail-closed generation。** gate 以 `connectionGeneration` 作为 live pair key，对除 `jti` 外的 scope 做 fingerprint，并单独跟踪 `jti`，每个 `sid` 只允许一个 live generation。重复 stream、变化的 scope、`jti` 跨 generation 重用，或同一 session 出现不同 connection generation，都会关闭既有 sibling 并拒绝新 upgrade。首次 admission 时，`expiresAt` 的内部 timer 会在没有后续 carrier request 的情况下关闭两条 downlink 并消费其 JTIs；generation failure 与 plugin dispose 会清理 timer。这补偿了只下行 carrier 缺乏浏览器业务消息、无法发起第二次 pairing exchange 的限制。

## Control-plane adapter mapping

上游 control-plane adapter 只对精确 `connectionGeneration` 与已请求的 `dsh_web_v1` carriers 做一次 opaque ticket exchange，并缓存返回 claims。`SessionID`、`OperatorID`、`TenantID`、`WorkspaceID`、`RuntimeRef`、`Generation`、`Audience`、`Origin`、`ConnectionKind`、`JTI` 和 `ExpiresAt` 映射到 DSH binding fields。`ConnectionKind` 限制 verifier request 可接受的 `http`、`events.mux` 或 `events.host` carrier。

`MembershipRevision`/`ScopeRevision`、`InstallationID`、`ReleaseDigest` 与 `PolicyRevision` 仍是 verifier-owned preconditions。connection package 没有可用于比较的权威 installation、release、membership 或 policy projection。这是已记录的兼容性缺口：canary 不声称 Aigora ↔ DSH 已完成直接生产闭环。

## Alternatives considered

**在 DSH 中解析 provider OAuth credentials。** 拒绝，因为 provider-token refresh、用户登录状态和身份权威属于 control plane，而本包只负责浏览器 transport admission。

**以 `jti` 作为 WebSocket pair key。** 拒绝，因为两张 JTI 不同的有效 ticket 可能分别创建 mux 与 host，并处于不同 connection generation。`connectionGeneration` 才是 pair owner；`jti` 保留为 replay correlation key。

**默认对 remote Web 启用 ticket。** 拒绝，因为未配置 verifier 的部署无法认证。local mode 保持显式，直到企业 composition 提供 verifier。

## Consequences

该包可与 keyless fake control-plane adapter 组合，并在 API dispatch 或 upgrade negotiation 前拒绝无效 binding。canary 不提供 OS 隔离、tenant data isolation、sandbox lifecycle、OAuth login、持久化、issuer implementation 或 distributed replay storage。生产 owner 必须提供 atomic exchange/revocation authority、cookie policy、durable replay semantics，以及对暂缓 installation/release/policy fields 的本地 projections 或权威 adapter decision。

## Testing

focused host tests 覆盖缺失、过期、scope 不匹配与重放 ticket；cookie transport；全部 `dsh_web_v1` HTTP 与 upgrade entry；无需后续 request 的 hard expiry、sibling closure、consumed-JTI rejection、gate-disposal cleanup；通过真实 `ws` upgrade 验证不同 JTI／不同 generation 拒绝；以及不变的 local default。

子项目命令 `pnpm run test:evidence:access-ticket` 会运行 keyless ticket tests、Host typecheck 与显式 local timeout 的完整 client/host suite，并在 `temp/integration-test-runs/<run-id>/` 生成脱敏 evidence。该 evidence 仅属于 focused/local，不声称 OAuth provider、sandbox、云 Agent、部署或 production acceptance。
