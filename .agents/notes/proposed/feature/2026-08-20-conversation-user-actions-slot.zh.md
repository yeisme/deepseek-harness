# Agent Note：会话 user-actions 插槽

Status: proposed

[English](2026-08-20-conversation-user-actions-slot.md) | 中文

## 问题

会话聊天面目前只有一条按消息寻址的动作插槽 `conversation.chat.assistant-actions`，以已定稿的 assistant `messageId` 寻址。用户消息没有对等扩展点：其 IconActions 行被硬编码为复制 + 时钟，插件无法贡献针对某条用户消息的动作——而这正是"编辑本条消息后重发""从本条消息之前重试""按消息查看来源"等能力所需的挂载面。历史后果只有两种：无后端的死按钮 stub，或干脆没有入口。

## 提案

在 `packages/client/ui-conversation` 增加对称插槽：

```ts
'conversation.chat.user-actions': {
  kind: 'list'
  scope: 'session'
  owner: UserActionOwnerProps
}
```

```ts
export interface UserActionOwnerProps {
  /** Stable identity carried from the `user/message` event; absent on plain user nodes. */
  messageId?: MessageId | undefined
  /** Engine-owned node seq; the durable fork-addressing currency for user nodes. */
  seq: number
}
```

`UserMessageNodeView`（`user` 与 `steering` 两个 key）将该插槽声明为 child，渲染进 `MessageIconActions.extraActions`，位于内建复制与时钟控件之间——与 assistant 动作条同一落点纪律。事件语法决定了两条寻址事实，并冻结进 owner 类型：

- 普通用户节点没有持久 `messageId`；引擎持有的 `seq` 是寻址货币（会话 fork 同样以它寻址）。
- 已采纳的 steering 节点携带 `user/message` id，因此 `messageId` 为可选，仅在该类节点出现。

`UserMessageNodeView` 已经从带 key 的 `conversation.chat.node` 座位拿到 `ChatNodeOwnerProps`。这次只增加子插槽的渲染份额，不会把 `openFile` / `inspectCall` / `forkAt` 交给用户动作条。变更语义仍由消费该插槽的插件负责。

## 考虑过的替代方案

**仅以 `messageId` 寻址。**普通用户节点没有该字段，不可行；会迫使贡献者猜测或自行推导 seq。

**单一消息无关插槽加 `role` 字段。**为不存在的消费方扩大所有现存贡献者的匹配面；assistant 动作条"已定稿消息"的不变量也会被稀释。

**不做插槽，把编辑/重试做进 dsh core。**变更语义（fork 后重发）已可由独立插件用 `session.fork` + `session.prompt` 组合出来；缺的只是渲染落点，而插槽正是为此存在。

**把 `UserMessageNodeView` 的 `renderSlot` 做成可选。**不予采用。渲染器始终拥有子插槽落点；fixture 和 ChatView 的带 key 分发器必须传入类型正确的空桩，这与 `TurnTailNodeView` 已经要求 `renderSlot` / `renderSlotChain` 的做法一致。

## 验收标准

- 贡献的 `conversation.chat.user-actions` 条目渲染进用户 IconActions 行，位于复制与时钟之间，且无需 import 会话实现。
- 普通用户 owner 为 `{ seq }`；已采纳 steering 的 owner 为 `{ messageId, seq }`。
- 空贡献列表不渲染额外标记；复制与时钟保留。
- 进行中的轮次视为不可寻址：贡献者禁用动作，而不是静默隐藏。
- `pnpm run typecheck` 与聚焦的 ui-conversation spec 保持通过，包括 ChatView 的带 key 分发器和 MessageItem fixture 适配器。

## 风险

该插槽只是渲染落点。若插件忽略进行中轮次的规则，仍可能画出不能用的编辑/重试按钮；核心除文档约定外不强制禁用。

零贡献者时必须与当前 chrome 逐字节一致。若给空列表再包一层，会改掉目前只假设复制 + 时钟的快照和布局测试。

`seq` 对 fork 是持久寻址货币，但不是面向用户的身份。插件若把它当作 message id 来持久化或展示，会在回退、fork 和 steering 采纳时出错。
