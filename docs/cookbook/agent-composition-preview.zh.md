# Agent 组合预览：在会话存在之前投影一个 preset

[English](agent-composition-preview.md) | 中文

一个 preset 决定会话的整个模型可见面，但在组合预览（`dsh-agent-composition-preview` 包，现位于 `agent/harness-plugins`）之前，了解一个 preset 会 mount 出什么唯一办法是创建会话。`AgentCompositionPreview` service 在无 agent、无 session、无 turn 的前提下回答 picker 的三个问题：这个 preset 实际 mount 出什么、它是否健康、copy 是否偏离了来源。

## 读取一个投影

```sh
dsh composition preview --preset standard --json
dsh composition smoke --preset minimal
```

`preview` 在 stdout 打印恰好一个 `dsh.composition.preview.v0` 信封；`smoke` 打印脱敏的 `dsh.composition.smoke.v0` 报告，投影在全局留下任何注册时以非零退出。两者都 boot 真实 web profile，从不调用模型、不产生 token 成本。机器消费者（Ordo 的 `agent preview` adapter）按字段校验信封，并把 exit 1 当作拒绝而非空组合。

在 host 组合内，同样的事实来自 service：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-composition-preview'  // loads the ctx.get typing

export const inject = ['agentCompositionPreview']

export async function apply(ctx: Context) {
  const preview = ctx.get('agentCompositionPreview')
  if (preview === undefined) return
  const projection = await preview.project('standard')
  // projection.composition.tools: [{ name, schema_digest, source: 'preset' | 'global' | 'transport' }]
  // projection.health.provable_mount_ref: 'standing:standard:1'
}
```

## 投影保证什么

- **mount 级，而非 shape 级。** `shape_ok` 是 roster 的 discovery 检查；`mount_ok` 表示 standing mount 真的完成了组合。`provable_mount_ref` 指名应答的 mount；损坏或不可 mount 的 preset 是类型化的 `composition_invalid` 拒绝，而不是翻转标志位的投影。
- **只有 digest，没有正文。** 工具 schema 与 section 文本永不离开 service；信封携带 canonical JSON（键排序、无空白）的 SHA-256 digest，失败 reason 做了路径脱敏。
- **归属，而非猜测。** 每个工具、section 与投影单元都指名供给它的层（`preset`、`global` 或 Code Mode 的 `transport`），读取的是 registries 自己的归属缝——绝不靠集合差集推断。
- **漂移只报告，绝不修复。** copy 携带 service 写入的 `lineage.yml`；`none` / `diverged` / `unknown` 把冻结 digest 与两侧当前组合文本比较，回答不了的比较读作 `unknown`。

## 投影不裁决什么

风险、成熟度、资质与 receipt 是 Ordo owner 字段（split-owner handoff：根仓库 `openspec/changes/agent-composition-preview-v1/` change）。smoke 通过只证明本进程内 mount + 投影 + 清理；它不为一个 agent 组合发放 qualified，任何 DSH 面都不得如此呈现。
