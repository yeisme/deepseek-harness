# Agent Note: 渲染器无关 TUI 运行时垂直切片

Status: implemented

[English](2026-08-16-tui-runtime-vertical-slice.md) | 中文

## Problem

首个 DSH TUI 客户端需要先拥有可测试的交互核心，再让终端渲染器接管 raw mode、备用屏幕清理和按键解码。现有 SDK 通知已经携带会话状态、会话事件与子 agent 生命周期事实，但仓库还没有把这些事实转换为 queue/steer 输入、重放 effect、语义行和可清理插件贡献的客户端包。

## Decision

仓库新增 `packages/tui/runtime` 包 `@deepseek-ai/dsh-tui-runtime`。它的 `update(state, event)` 转换函数是纯函数，返回不可变状态以及明确的 `send-prompt`、`cancel-run` 和 `request-replay` effect。`reduceHarnessNotification()` 在 wire 边界适配现有结构化 SDK 通知，并忽略格式错误或不属于当前会话的通知。

运行时记录提示词回执、queue 与 steer 模式、连接恢复、持久事件游标、事件缺口、detach 后未读数和重放完成状态。它只把 user、assistant、tool 与 error 文本规范化为 `TuiBlock`；提供方载荷不会进入渲染行。`render(state, width, height)` 返回不含 ANSI 的语义行与截断元数据，终端生命周期以及 Pi/OMP API 留在包外。

`TuiController` 是转换函数外层的有状态 shell。它接受现有 SDK 通知结构，通过注入的提示词/取消/重放服务接口串行执行调用，应用回执与重放结果，并把服务错误转换为用户可见 notice。销毁 controller 会停止后续 effect 并释放监听器。

`TuiPluginRegistry` 管理受信任且与渲染器无关的命令和面板贡献。插件 id 为命令和面板提供命名空间，重复 id 会在注册时失败，快照会排序并复制，每次注册都返回幂等 disposer，供退出和 HMR 清理。

## Alternatives considered

**把状态机嵌入 Pi 渲染器**被否决，因为 raw-mode 生命周期、绘制逻辑和服务行为会变成一个难以测试的循环，OMP 或无头渲染器也无法复用同一交互约定。

**新增一套 TUI 专用服务协议**被否决，因为现有 SDK JSON-RPC 通知已经提供会话和子 agent 事实；本切片只增加客户端投影，不重复 Host 所有权或持久状态。

**接受任意插件渲染回调**被否决，因为回调会把插件绑定到终端库，并让重放与快照行为依赖渲染器。首版注册表只暴露带命名空间的数据贡献；交互式命令路由留给后续扩展。

## Consequences

首个垂直切片可以在单元测试中使用，未来 Pi 适配器可以直接消费其状态模型而无需改变交互约定。重放 effect 已明确存在，但需要后续服务端点响应游标请求。该包不启动服务、不打开 socket、不加载不受信任插件，也不进入终端 raw mode；这些职责仍由 [TUI 交付 DAG](../../proposed/architecture/2026-08-16-tui-service-delivery-dag.md) 中的服务和应用切片承担。

该包使用 TypeScript，因为它负责控制平面状态、插件元数据和渲染器胶水；当前没有需要 Go 或 Rust 的实测系统边界或发行边界。聚焦测试覆盖提示词回执、steer 模式、事件缺口重放、确定性重放排序、有界语义渲染以及 disposer 清理。
