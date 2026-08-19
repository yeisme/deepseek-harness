# Agent Note: Web composer 的未激活 Plan 入口控件

Status: implemented

[English](2026-08-15-ui-plan-inactive-entry-control.md) | 中文

## 问题

Web composer 只能通过共享的 `/plan` slash command 或 `+` Command 菜单进入 plan mode。具备 plan 能力但 mode 未激活的会话在工具行没有直接入口，进入 plan mode 多了一步发现成本，而且既有的 `chip.off.*` locale 键未被使用。

## 决策

`@deepseek-ai/dsh-client-ui-plan` 现在会在 host 计算的 `plan` 投影存在且有效目标为稳定默认模式（`active: false, pending: false`）时，渲染中性的 "Plan" 入口 chip。点击后与既有激活态 chip 一样，通过 `remote.commands.execute` 执行 `/plan`。激活态 warn chip 不变；待处理退出（`active: true, pending: true`）时座位仍然留空，避免用户与正在进行的 `/plan off` 冲突。

注入面在 `exitPlanMode` 之外新增 `enterPlanMode`；两者都把准入/传输失败折叠为用户可见失败行。未激活控件复用 composer 中性 chip 样式（`--dsw-alias-label-secondary` / `--dsw-alias-interactive-bg-hover`），并沿用既有 locale 键。

## 测试

- 组件测试覆盖缺失能力、稳定未激活、pending 进入、激活、pending 退出、单次点击准入、locked 状态、失败可见性以及进入/退出两者的 unmount 安全。
- Browser-plugin 测试覆盖注入的 `/plan` 与 `/plan off` 面、业务失败折叠与 teardown。
- Web snapshot 已更新，在每种稳定 composer 状态中包含未激活 Plan 控件。

## 考虑过的替代方案

**入口只保留在 slash command 菜单。** 否决，因为 locale 键与单 seat 已经预示直接控件，而且可见入口 chip 能消除发现成本，不增加客户端 plan 状态。

**在 pending 退出期间也渲染未激活控件。** 否决，因为用户已经请求 `/plan off`；额外控件会与进行中的切换冲突。

## 后果

- 用户可以直接从 composer 工具行进入 plan mode。
- 当 plan 能力缺失、处于 Draft 或 pending 退出时，座位仍然不渲染控件。
- plan 状态与命令语义不变；host `/plan` 命令仍是唯一写路径。
