# Agent Note：Agent Preset 的 Standing-Scope 组合投影

Status: proposed

[English](2026-08-14-agent-composition-preview-projection.md) | 中文

## 问题

一个 preset 决定会话的整个模型可见面，但在此变更之前，“这个 preset 实际 mount 出什么”的唯一证明是创建一个会话：roster 的健康检查只证明 shape、`trust` 仅作展示、copy 出的 preset 没有 lineage，漂移不可见。根 `agent-composition-preview-v1` handoff 冻结了 split owner：组合事实由 DSH 投影；风险、成熟度、资质与 receipt 属于 Ordo。

## 提案

`@deepseek-ai/dsh-agent-composition-preview` 复用冷读机制做投影：`standingFactsFor(id)`（加在 `standingKeyFor` 背后的读侧身份）确保 standing mount 并返回其 scope key、组合文件 stamp 与 generation。投影随后在该 scope key 下读取 registries——`tools.schemas(key)`/`tools.sources(key)`、`systemPrompt.assemble({scope: key})`/`sectionSources(key)`、`sessionProjections.attributions()`——全程无 agent、无 session、无 turn，并输出带 digest 的事实（`dsh.composition.preview.v0`）与脱敏 smoke 报告。

### Standing-scope 读口

registries 此前已能按 scope key 寻址（schemas、assemble、冷读 presenter），但说不出一个条目来自**哪一层**，归属只能靠集合差集猜测、且会漏掉 scoped 遮蔽。三个最小 additive 读口补上这一点：`ToolRuntime.sources()`（在 `view()` 既有遍历内构建：global → scoped 遮蔽 → 保留的 Code Mode `transport`）、`SystemPrompt.sectionSources()`（与组装遮蔽合并相同的最近层胜出规则）、`SessionProjectionRegistry.attributions()`（在既有引用计数旁记录每个注册者的 scope；一个键映射到持有它的 scope 集合，缺省 scope 表示上下文全局注册者）。三者均为只读、与其兄弟视图的键集合完全一致，并有含 dispose 在内的 focused 测试。

### Digest 规范化

工具 digest 是 `{name, description, parameters}` 的 canonical JSON 的 SHA-256；section digest 对解析后的文本取哈希；`capability_digest` 对 canonical 的 composition 段取哈希。canonical JSON 对对象键做升序排序（码元序）、保持数组顺序、不输出空白——因仓库没有共享 canonical 化器而实现在包内（`digest.ts`），并用固定向量测试钉住，使规则或被 digest 字段的任何变更都是刻意的 digest 断裂。失败 reason 在 service 边界做路径脱敏：信封要交给 picker 与机器消费者，宿主机路径是机器的事实而非组合的事实。

### Lineage 与漂移

`copy()` 写入 service 生成的 `lineage.yml`（`dsh.preset_lineage.v0`），冻结来源 id、copy 时来源的**组合文本** digest 与复制时间；它覆盖目录复制带来的旧文件，因此 copy 的 copy 指向自己的来源。漂移把该冻结 digest 与两侧当前组合文本比较——双侧一致为 `none`、任一侧编辑为 `diverged`、lineage 缺失/损坏或来源已删为 `unknown`。设计草案比较的是 mount 级 `capability_digest`；改用文本 digest 的理由：可在 `dsh-agent-presets` 内于 copy 时计算（不引入服务顺序依赖）、能检出 mount 等价的编辑、并在任何 mount 存在之前就有意义。漂移只报告，绝不修复。

### CLI

`dsh composition preview|smoke` 通过 `runProfile` boot **真实** web profile，附带 web app 自己的 `--port 0` 和静默 URL 行的 inline overlay，因此 stdout 只携带一个信封。app 行必须激活（boot 审计会拒绝永远等待的树），“app 休眠 boot”因此被否决；OS 分配的临时端口让一次性命令不占用任何固定端口。smoke 在残留窗口前预热 standing mount——mount 是直到整树销毁都合法的共享状态而非残留——所以 `residue: 'detected'` 指控的是投影读取本身。

## 备选方案

**只从 roster 文件文本投影。** 否决：文件 shape 不是 mount 真相；unscoped target、不可用 row 与 root realm 的拒绝只发生在 mount 时，而这正是 picker 缺少的证明。

**用 scope 视图与全局视图的差集推断归属。** 否决：scoped 工具遮蔽同名全局工具时差集无法区分；registries 自己的层才是唯一权威。

**在 lineage 里计算 mount 级 digest。** 否决：这会让 `dsh-agent-presets` 依赖投影服务才能写下一个组合文本已能确定性钉住的事实。

**为 CLI 命令做专用 profile。** 否决：roster 随 web-app bundle 发布；并行的组合会是“本部署 mount 什么”的第二份答案。boot 真实 profile 才是会话拿到的同一台机器。

## 验收标准

- 投影 digest 与同 preset 上已加入会话的 agent 所见一致（对 `schemas(agent)` 与 `assemble(agent)` 的 focused 交叉校验）。
- 损坏 preset 以类型化 `composition_invalid` 拒绝且 reason 已脱敏路径；未知 id 透传 roster 错误。
- `smoke` 在干净读取时报告 `residue: 'none'`，在 section 求值夹带全局注册时报告 `detected`（focused 负向测试）。
- built bin 在 stdout 打印恰好一个信封、拒绝时 exit 1；已对真实 web profile 验证（`composition.e2e.ts` 与手动 built-bin 运行）。
- 任何 DSH 信封永不出现风险、成熟度或资质字段。

## 风险

**信封可能被误读为资质。** Ordo 拥有风险/成熟度/receipt；README 与 cookbook 写明边界，smoke 报告刻意不携带分类字段。

**归属缝扩大了 registries 公共面。** 每个缝都只有一个与其兄弟视图同键的读方法；未来消费者若需更丰富的归属（插件身份），那是有独立证据的新决策。

**picker 面板尚未交付。** 客户端安全的信封类型已落在 `./types`；渲染它们是下一片，且必须让 maturity 槽位只渲染 owner 注入值或隐藏。
