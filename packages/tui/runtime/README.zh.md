# @deepseek-ai/dsh-tui-runtime

[English](README.md) | 中文

`@deepseek-ai/dsh-tui-runtime` 是 DSH 终端客户端的渲染器无关状态机。它消费规范化的服务通知，产生明确的提示词/取消/重放 effect，并输出 Pi、OMP 或测试渲染器可以绘制的语义行。该包不进入终端 raw mode，不拥有持久会话状态，也不解析提供方载荷之外的通知适配内容。

## 运行时约定

`createTuiState()` 创建会话级状态。`update(state, event)` 是确定性的，返回新状态与 effect。`TuiController` 通过注入的服务接口串行执行 effect，并应用提示词回执或重放结果。`reduceHarnessNotification()` 适配现有 DSH SDK 通知格式。`render(state, width, height)` 返回不含 ANSI 的语义行与截断元数据，供具体渲染器使用。

`TuiPluginRegistry` 接受受信任且与渲染器无关的命令和面板贡献。每个贡献必须使用插件 id 命名空间，注册操作返回幂等 disposer，供 HMR 和 shell 退出时清理。

## 模型体验

### TUI 状态投影

#### What the model sees

无。渲染器消费 `TuiState` 与 `render(...)` 语义行来呈现会话活动；该包不组装或发送模型提示词。

#### Token effect

无；状态转换和语义行不会增加模型可见输入。

#### KV Cache 影响

无；该包不调用提供方，也不修改模型上下文。

## 已知限制与暂缓事项

- 该包不包含 Pi/OMP 渲染器或终端生命周期适配器。
- 重放 effect 依赖能够从持久序列返回事件的服务端点。
- 插件面板当前只贡献稳定文本行；交互式面板动作属于后续命令路由切片。
