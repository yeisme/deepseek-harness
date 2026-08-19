# Agent Note: Web 编程模型路由

Status: implemented

[English](2026-08-13-web-coding-model-routes.md) | 中文

## 问题

Web profile 暴露了 Harness 模型选择器，却没有为已安装 pi-ai 目录中已有的编程模型提供开箱即用的路由。用户必须手动重建提供方 id、协议、端点和模型 id，而把原生 CLI 凭据文件复制进 Harness 又会违反凭据边界。

## 决策

**Web 组合层声明三条目录路由。** 它将 `openai-codex` 收窄到 `gpt-5.6-luna`，以 Anthropic Messages 协议和 `https://open.bigmodel.cn/api/anthropic` 端点声明 `glm-claude-code` 及模型 `glm-5.2[1m]`，并将 `kimi-coding` 收窄到 `k3`。已安装的 pi-ai 提供方继续负责各自的网络实现与模型元数据；只有 GLM 路由需要手工声明协议覆盖，因为 Claude Code 的端点不是 pi-ai 中独立的目录路由。

**凭据仍然使用 DSH 引用。** 路由在每次请求中通过 `ctx.credentials` 解析 `OPENAI_API_KEY`、`ANTHROPIC_AUTH_TOKEN` 和 `KIMI_API_KEY`。Web 组合层不会读取 Codex、Claude Code 或 Kimi Code 配置文件，不会导入 OAuth 存储，也不会把 secret 值放入 patch 文件。Codex 与 Kimi CLI 的 OAuth 仍由宿主产品负责，除非 Harness 适配器未来拥有兼容的持久化 OAuth 存储和登录流程。

**路由归属 Web 层。** base 组合包保留休眠的 `llm-pi-ai`，因此 headless 和其他 profile 不会获得额外网络路由或缺少凭据错误。现有 Web 模型设置页已经提供可配置提供方目录和凭据编辑器，不需要新增 client 界面。

## 曾考虑的替代方案

**自动导入原生 CLI settings 和 OAuth 文件。** 不采用：这些文件含有产品自有凭据，并且具有提供方专属的刷新语义，Harness 凭据服务无法安全推断或持久化。

**使用 OpenAI 兼容的 GLM Coding CN 路由提供 Claude Code 的 GLM 模型。** 不采用：用户请求的是 Claude Code 的 Anthropic 兼容端点，其请求协议和基础 URL 与 OpenAI Coding 路由不同。

**增加新的提供方适配器包。** 不采用：已安装的 pi-ai 目录已经拥有 Codex 与 Kimi 的实现，而 `llm-pi-ai` 已经支持所需的 Anthropic 兼容自定义路由。

## 后果

`dsh web` 会在模型设置和模型选择器中展示所请求的三个编程模型。凭据尚未配置时路由仍可见；真正请求前会沿用现有的 `MISSING_CREDENTIAL` 诊断，直到用户导出对应 token 或通过「设置 → 模型」存入它。GLM 模型按文档中的 1M 上下文配置定尺寸。原生 CLI 的 OAuth 登录不会自动被 DSH 复用，用户指南会明确说明这一点；未来认证集成仍以此为边界。
