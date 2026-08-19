# dsh-agent-composition-preview

[English](README.md) | 中文

对一个 agent preset 的组合事实做只读、mount 级投影。一个 preset 决定会话模型可见的一切——哪些工具、哪些 prompt sections、哪些投影单元、什么权限档——但这个答案过去只在会话创建之后才存在。本包在**无 agent、无 session、无 turn** 的前提下回答它：确保该 preset 的 standing mount（冷读使用的同一个 `standingKeyFor`），在该 scope key 下读取 `dsh-tools` / `dsh-system-prompt` / `dsh-session-projection` registries，并输出带 digest 的组合事实、三层 health 与 copy lineage 漂移。

只输出事实。风险分类、成熟度、资质与 receipt 属于 Ordo owner（split-owner handoff：根仓库的 `openspec/changes/agent-composition-preview-v1/` change）；本包既不计算也不暗示它们。

## Service：`AgentCompositionPreview`（ctx key：`agentCompositionPreview`）

- `ctx.agentCompositionPreview.project(id?): Promise<CompositionProjection>` 解析一个 preset（省略 `id` 时为 roster 默认值），确保其 standing mount，并投影其组合事实。preset 损坏或组合无法 mount 时抛出 `CompositionInvalidError`（`code: 'composition_invalid'`，`reason` 已脱敏路径）；未知 id 原样透传 roster 的 `UnknownPresetError`。
- `ctx.agentCompositionPreview.smoke(id?): Promise<SmokeReport>` 同一投影加清理判定：`residue` 在投影前后比较进程的全局 registry 面（全局可见的工具名、section 名、投影单元键、已提供的 service 名）。standing mount 会先预热——mount 是合法共享状态而非残留——所以 `residue: 'detected'` 表示投影读取本身留下了注册。

该 service 是纯读：无订阅、无持久化写、无逐调用注册。每次调用都重读 roster，进程运行期间新建、编辑或删除的 preset 由下一次调用回答。

## 信封：`dsh.composition.preview.v0`

```yaml
schema: dsh.composition.preview.v0
preset:
  id: standard
  trust: system                    # 来自发现该 preset 的 root
  composition_stamp: { mtime_ms: 0, size: 0 }
  generation: 1                    # 本进程内该 id 的第几次 mount，从 1 起
health:
  shape_ok: true                   # discovery 解析出 named-row 组合
  mount_ok: true                   # standing mount 在无 agent 下完成组合
  provable_mount_ref: standing:standard:1
drift:                             # copy 与其来源的关系
  state: none | unknown | diverged
  source_id: standard              # 读到 lineage 时出现
  source_digest: <sha256>          # copy 时来源组合文本的 digest
  copy_digest: <sha256>            # copy 文本可读时出现
composition:
  tools:
    - name: bash
      schema_digest: <sha256>      # {name, description, parameters} 的 canonical JSON
      source: preset | global | transport
  prompt_sections:
    - id: preset:alpha
      section_digest: <sha256>     # section 解析后的文本
      source: preset | global
  projection_units:
    - key: permissions
      source: preset | global      # 仅由其他 scope 注册的单元被省略
  permissions:
    sandbox_mode: workspace-write  # 或 unknown_reason——绝不默认
    approval_policy: ask
    contrib_source: host           # 权限档是 host 平面事实
capability_digest: <sha256>        # composition 段的 canonical JSON
generated_at: <ISO-8601 UTC>
```

digest 使用 canonical JSON（对象键升序排序、无空白），由固定向量测试钉住；修改规范化规则或被 digest 的字段都是刻意决策，会改变所有 digest。失败 reason 做了路径脱敏：信封要交给 picker 与机器消费者，宿主机路径是机器的事实而非组合的事实。

`dsh.composition.smoke.v0` 携带脱敏摘要——preset、health、计数、`permissions_known`、drift、`capability_digest`、`residue`、`elapsed_ms`——不含 schema 正文、section 文本、prompt 或宿主机路径。

## CLI

`dsh composition preview --preset <id> --json` 与 `dsh composition smoke --preset <id> --json` boot 真实 web profile（内置唯一组合 roster 的 profile），投影、在 stdout 打印恰好一个信封并退出；见 [`apps/cli`](../../../apps/cli/README.zh.md)。投影成功（smoke 还要求清理干净）exit 0；任何拒绝、失败或检测到残留 exit 1。机器消费者按上文字段校验信封。

## Lineage 与漂移

`dsh-agent-presets` 的 `copy()` 会在 copy 的组合文件旁写入 `lineage.yml`（`dsh.preset_lineage.v0`：`source_id`、copy 时来源组合文本 digest、`copied_at`）。漂移把冻结 digest 与两侧当前组合文本比较：双侧一致为 `none`，任一侧编辑为 `diverged`，无 lineage、来源已删或任一侧文本不可读为 `unknown`——回答不了的问题绝不报告为一致。漂移只报告，绝不修复。

## Config

无。service 注入 `agentPresets`、`tools`、`systemPrompt`；`sessionProjections`、`shell`、`approval` 为可选读取，投影围绕其缺失降级（单元省略、permissions 给 `unknown_reason`）。

## Model Experience

对任何模型请求无影响：service 不 mount 任何模型可见 row、不新增 session event、永不进入会话组合。它读取的是会话共享的同一批 standing mount。

## Known Limitations and Deferred Work

- preset picker 的只读 Preview 面板与 `ToolView` 展示契约推迟到 client 切片（`dsh-agent-composition-preview-v1` 任务 3.x）：信封类型已以客户端安全形式发布在 `./types`，但尚无浏览器面渲染它们。
- session-projection registry 进程级地为每个会话服务所有已注册单元；信封因此只报告该 preset 自己的与上下文全局的单元，仅由**另一个** preset 注册的单元被省略而非归属。按会话限定单元作用域将是 `dsh-session-projection` 的变更。
- 模型可见的 `agent_preview` 工具为 retain-next：若实现，必须满足 model-visible ⟺ logged 并新增 session event。
- 风险、成熟度与资质是 Ordo owner 字段，永不出现在本信封。
