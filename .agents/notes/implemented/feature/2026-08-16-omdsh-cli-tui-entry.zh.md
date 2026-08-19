# Agent Note：`omdsh` CLI 入口与首个可运行 DSH TUI shell

Status: implemented

[English](2026-08-16-omdsh-cli-tui-entry.md) | 中文

## 问题

渲染器无关的 TUI runtime 已经具备确定性的状态转移与插件能力类型，但用户还不能从产品命令启动它。旧文档中的 `dsh --profile tui` 指向一个并未随当前代码树发布的 profile，因此第一次使用既不诚实，也无法执行。

## 决策

现在 `dsh tui` 是正式的 launcher 模式，`dsh --profile tui` 也会解析到同一模式，不再要求 profile 目录存在。包同时发布 `omdsh` bin 别名；launcher 在解析前把这个可执行文件名归一化为 `dsh tui`，因此 shell 别名和包管理器 shim 共享同一套语法。

CLI 只负责终端边界。`apps/cli/src/tui.ts` 创建 `TuiController`，从 `@deepseek-ai/dsh-tui-runtime` 渲染语义 frame，并把 raw mode、alternate screen、光标和监听器清理放进统一退出路径。输入处理保持很小：可打印字符编辑 composer，`Enter` 提交，`Ctrl+C` 中断或在空闲时退出，`Ctrl+G` 分离视图；冒号命令覆盖帮助、模式、清空、重新连接视图和退出。

当前发布的 service adapter 是明确通过 `--demo` 开启的进程内回环服务。它发出与 runtime 边界相同的结构化 `session.status` 与 `session.event` 通知，因此可在无凭据、无外部模型的情况下验证事件游标、本地 echo 对账、receipt、渲染和中断。真正的 DSH IPC/service adapter 保留为独立后续 seam；在该适配器可以诚实应用 overlay 之前，`--patch` 只解析并拒绝执行。

非 TTY 调用会打印稳定帮助或确定性 frame。`--once` 是脚本化 smoke 路径；交互式 TTY 才进入 raw keypress loop 与语义 renderer。这样终端 shell 保持很薄，状态机仍可以脱离 raw mode 测试。

## 曾考虑的替代方案

- **启动不存在的 `tui` profile：** 否决；干净 checkout 上记录的命令必须可用，profile 初始化会掩盖真正的 service 边界。
- **让 TUI 直接连接 provider 或在 CLI 读取凭据：** 否决；客户端必须消费 DSH service contract，不能变成 provider 编排或 secret 持久化的 owner。
- **把 `omdsh` 做成仅 shell 侧 alias：** 否决；package `bin` alias 兼容 npm、pnpm 和直接安装，也能通过 argv 归一化测试。
- **把业务行为写进 keypress loop：** 否决；`update` 与 `render` 继续是确定性 runtime contract，loop 只负责把终端事件映射为语义事件，并通过 controller 执行 effects。

## 后果

`dsh tui --demo`、`omdsh --demo` 和 `omdsh --demo --once "hello"` 现在都是可用的本地入口。包拥有稳定的快捷命令语法，并以命令测试覆盖 launcher 归一化、TUI flags、冒号命令、one-shot 输出和 service 未配置失败路径。下一段实现只需要在 CLI 边界替换 `TuiServicePort`，交互模型、插件 registry、渲染器无关 state 与 smoke 命令都可以保持不变。
