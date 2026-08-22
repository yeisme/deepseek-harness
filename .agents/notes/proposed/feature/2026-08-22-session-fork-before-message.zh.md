# Agent Note: session.forkBeforeMessage

Status: proposed

[English](2026-08-22-session-fork-before-message.md) | 中文

## Problem

`session.fork` 只会在锚点处或之后的已完成 `turn/end` 切开。第一条用户消息之前没有已完成轮次，因此 Edit/Retry 插件无法创建排除该消息的 child。沿用现有 fork 要么 `fork-unavailable`，要么把原首轮回答留在 seed 里。

## Proposal

新增 additive RPC `session.forkBeforeMessage`：

```ts
request: { sessionId: SessionId; atMessageSeq: number }
response: { sessionId: SessionId }
```

语义：

- 定位 `seq === atMessageSeq` 的事件。
- 以该 seq 之前最近一次已完成 `turn/end` 作为 child seed。
- 若没有更早的 `turn/end`，创建 `seedLength: 0` 的 child。
- cwd、`parentSession`、composition 与 workspace 归属与 `session.fork` 相同。
- 未知 seq 返回 `fork-unavailable`，不得随意裁到更早的轮次。

客户端仍通过现有 `session.prompt` 发送编辑或重试后的内容。新 RPC 只负责 fork。

## Alternatives considered

**给 `session.fork` 增加 `atSeq: 'before-message'`。** 否决。这会把已完成轮次切开与“消息之前切开”叠在同一方法上，改变既有语义。

**做一个同时 fork 并 prompt 的 `session.rewriteAt`。** 否决。准入、附件和 slash 命令已属于 `session.prompt`；再写进 fork 会复制发送策略。

**新建一个没有谱系的空 session。** 否决。首轮改写仍需要 `parentSession`、cwd 和 workspace 归属，child 必须是源会话的分支。

## Acceptance criteria

- 首轮 `atMessageSeq` 产生 `seedLength: 0` 的 child，并继承 cwd/parentSession 与 workspace attach。
- 后续消息切在该 seq 之前最近一次已完成轮次，且不包含被寻址消息。
- 未知 seq 返回 `fork-unavailable`。
- 既有 `session.fork` 行为不变。
- 聚焦 host/client spec 保持绿色。

## Risks

空的首轮 child 在插件 prompt 之前是 blank。把 blank child 当可丢弃草稿的 UI，不能在 prompt 落地前删掉改写分支。

该 RPC 是 additive。旧客户端会忽略它；新插件必须先探测再调用。
