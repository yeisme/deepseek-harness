# @deepseek-ai/dsh-task-basis

[English](README.md) | 中文

基于会话日志的长期任务 basis 捕获与冲突检测。`ctx.taskBasis.capture(session, taskId)` 在任务启动前记录最新 `plan/document` seq 与 `spec/document` seq；`ctx.taskBasis.check(session, taskId)` 将 basis 与当前 fold 比较，并追加 `task/conflict` 判定。

版本使用会话事件 seq：单调、全日志、可恢复/fork 重建，无需为每种文档类型增加 revision 字段。

## API

- `ctx.taskBasis.capture(session, taskId)`：追加 `task/basis`。
- `ctx.taskBasis.check(session, taskId)`：追加 `task/conflict`，判定为 `safe` 或 `needs-merge`。
- `foldPlanSeq(events)` / `foldSpecSeqs(events)` / `foldTaskBasis(events, taskId)` / `foldTaskConflict(events, taskId)`：用于测试与投影的纯 fold。

## 模型体验

`task/basis` 与 `task/conflict` 仅记日志，绝不进入模型历史。调用方可以把冲突判定作为普通工具结果喂回模型。

#### KV Cache 影响

不会直接失效；消费方负责任何请求前缀变更。

## 已知限制与暂缓事项

- **目前非 safe 只有 `needs-merge`**：`blocked` 需要任务与 plan/spec 变更的作用域交集数据，应由未来的 task-basis 策略层提供。
- **没有自动合并**：服务派生并持久化冲突；解决冲突是调用方的策略。
