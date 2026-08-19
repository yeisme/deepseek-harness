# Agent Note: 将 Ordo Agent Ops 保持为 DSH adapter

Status: proposed

[English](2026-08-14-ordo-agent-ops-dsh-adapter.md) | 中文

## 问题

DeepSeek Harness 需要展示 Ordo-backed run 的企业 Agent Operations，但 DSH 不拥有 Ordo scheduling、writer lease、durable reservation、approval、verification 或 domain receipt。把这些事实放进 DSH 插件会创建第二个 state owner，并让单个 DSH process 看起来像多租户 control plane。

## 提案

DSH 实现放在 Ordo Agent Ops OpenSpec（已随插件迁至 `agent/harness-plugins/openspec/changes/ordo-dsh-plugin-visualization-v1/`）。它提供 Cordis host plugin、类型化 client service、Web client module、profile/组合包组装和 ToolView 展示。host 将一个 runtime generation 绑定到一个 tenant、workspace 和 runtime subject；浏览器只消费安全投影；Ordo 继续拥有 run、task、session、runtime、lease、worktree、approval、verification、evidence 和 closeout 事实。

首个 DSH 切片只包含 read-only snapshot、基于 cursor 的事件、attention/approval 展示和 owner-authored reconciliation。launch、cancel、redispatch、takeover 和 durable capacity reservation 要等 Ordo 提供权威合同后再开放。

## 备选方案

**让 DSH 成为 Agent Operations owner。** 拒绝：DSH session events 和 plugin lifecycle 不能替代 Ordo 的 DAG、lease、worktree、verification 或 reservation authority。

**把完整 Studio 放进 DSH Web。** 拒绝：DSH 是单租户 Harness runtime；完整多租户导航、安装管理和跨 run 操作属于 Workbench。

**让浏览器直接调用 Ordo。** 拒绝：浏览器不能拥有 tenant authorization、audience-scoped credential、cursor 生命周期或 redaction。host 或 BFF 必须返回类型化安全投影。

**在首个插件切片中开放 launch 和 redispatch。** 拒绝：当前 Ordo capacity projection 只读，不创建 durable reservation，也不能证明进程 liveness。未知结果会允许 duplicate writer。

**在 owner event 合同之前不做任何 cursor 逻辑。** 对 snapshot 轴拒绝：浏览器控制器已经在消费带版本的整体 snapshot，因此它基于 `snapshotRef`/`snapshotVersion` 维护 snapshot 轴 cursor——重复 version 幂等忽略，ref 轮换或 version 回退 fail closed 且不展示事实，下一次读取从新的权威 snapshot 重建 cursor。事件序号 cursor 与 gap 检测仍等待 owner event 合同，因为只有 owner 能区分合法的 stream 轮换与回滚攻击。

## 验收标准

- DSH 包使用官方 Cordis plugin、`dsh.client`、profile/bundle、command、tool 和 ToolView 扩展点。
- tenant/workspace/runtime context 变化时，在加载新 context 前清除 subscription、cursor、cache、selection 和 pending action。
- snapshot 和 event consumer 在 gap、stale cursor、contract drift、membership revoke 和 runtime generation 变化时 fail closed。
- unknown、partial 和 cancel-unknown 结果必须 reconcile，不能触发自动 retry 或 replacement writer dispatch。
- browser projection 排除 credential、generic bearer、raw prompt、provider payload、private tool arguments、absolute path、PID 和完整思维链。
- package、profile、Web、accessibility、redaction 和 disposal 测试覆盖实际组装入口。

## 风险

**用户可能把 DSH 面板误认为 scheduler。** 每张操作卡都显示 server-authored action、owner、receipt、freshness 和 blocker state。

**DSH 与 Workbench 的共享合同可能漂移。** 在 owner contract 中维护 action、receipt、reason-code 和安全投影 fixtures，并从两个 host 运行 conformance 测试。

**未来可能要求多个用户共享一个 DSH runtime。** 在独立架构决策证明 per-session authorization、storage isolation、credential isolation 和 lifecycle teardown 之前，不放宽单 tenant 不变式。
