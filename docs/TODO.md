# svn-merge-tool 重构 TODO

## 已确认原则

- 在修订版本列表最终确定之后，CLI 与 WebUI 必须共享同一套合并业务逻辑。
- 手动选择修订版本是 WebUI 专属能力。
- CLI 保持面向终端的交互方式。
- WebUI 保持面向浏览器的交互方式。
- WebUI 运行时：
  - `-V` 输出详细终端日志。
  - 非 `-V` 仅输出高层终端状态。
- `svnmerge-ui` 主进程保持存活，直到网页关闭后再退出。
- `cleanup` 是共享业务能力。
- 新增独立命令：`svnmerge cleanup`。
- `svnmerge cleanup` 是正式的一等命令，用于将工作副本恢复为干净状态。
- `cleanup` 提供 `--yes` 用于跳过确认。
- 不需要支持 `dry-run`。
- 执行前的统一语义边界为：
  - 确认最终修订版本集合
  - 确认最终运行选项
- CLI 与 WebUI 的错误恢复策略必须一致：
  - summary 一致
  - 成功/失败判定一致
  - 退出码语义一致
  - 仅前端呈现方式不同
- 发现 dirty workspace 时，merge 必须被阻止，CLI 与 WebUI 均不可继续执行。
- 终端输出、文件日志、WebUI SSE/页面输出都必须来自同一份事件源。
- 对外命令形态已经确定为：
  - `svnmerge run`
  - `svnmerge cleanup`
  - `svnmerge` 默认等价于 `svnmerge run`
  - `svnmerge-ui`
  - `svnmerge ui` 是 `svnmerge-ui` 的别名
- 命令入口文件不允许承载业务规则，只负责组装 workflow 与 adapter。
- 架构必须明确拆分为：
  - 共享原子能力模块
  - 共享 workflow 编排
  - CLI 专属 orchestration
  - WebUI 专属 orchestration

## 目标架构

### 核心原则

将工具拆成三层：

- 输入层：解析配置、CLI 参数、WebUI 请求、修订版本选择。
- 核心层：归一化选项、执行 workflow、产出结构化事件与结果。
- 输出层：渲染到终端、文件日志、WebUI 流与页面。

### 共享与模式专属

共享部分：

- 配置解析
- 运行选项归一化
- 修订版本表达式解析
- 合并前检查
- update / merge / summary / message / commit / cleanup 逻辑
- 结果模型与事件模型

CLI 专属：

- CLI 命令解析
- 终端确认提示
- 终端版修订版本预览与确认流程
- CLI orchestration 与终端 adapter 组合

WebUI 专属：

- 修订版本列表页
- 手动选择与过滤修订版本
- 浏览器渲染与更友好的可视化展示
- WebUI orchestration 与 SSE/浏览器 adapter 组合

## 重构目标

1. 修订版本确定之后，只有一套 workflow 实现。
2. 终端、文件日志、WebUI 共享同一个事件源和事件模型。
3. 不允许再把业务逻辑隐藏在 [`src/index.ts`](/d:/svn-merge-tool/src/index.ts) 或 [`src/webui.ts`](/d:/svn-merge-tool/src/webui.ts) 中。
4. 核心逻辑不得直接写 `process.stdout`。
5. `cleanup` 必须成为共享的一等命令，而不是 UI 的附带副作用。
6. 对于相同的最终修订版本集合和运行选项，CLI 与 WebUI 必须做出相同的执行决策。

## 当前问题

- [`src/pipeline.ts`](/d:/svn-merge-tool/src/pipeline.ts) 已经是共享雏形，但只共享了一部分；CLI 仍在 [`src/index.ts`](/d:/svn-merge-tool/src/index.ts) 中维护独立执行路径。
- [`src/webui.ts`](/d:/svn-merge-tool/src/webui.ts) 同时承载了 UI 服务逻辑和 merge worker 编排。
- [`src/merger.ts`](/d:/svn-merge-tool/src/merger.ts) 直接写 `process.stdout`，阻碍输出抽象。
- [`src/svn.ts`](/d:/svn-merge-tool/src/svn.ts) 中包含耦合到终端 IO 的交互式重试行为。
- 修订版本解析和选项归一化存在重复实现。
- CLI 与 WebUI 还没有统一到同一套命令模型上。

## 建议模块

### 1. Commands / Adapters

- `src/commands/run.ts`
- `src/commands/cleanup.ts`
- `src/commands/ui.ts`
- `src/adapters/cli/*`
- `src/adapters/webui/*`

职责：

- 解析用户输入
- 组装 adapters
- 组装 orchestration 与 workflow
- 不在这里做业务规则决策

### 2. 共享原子模块

- `src/modules/config/*`
- `src/modules/exit-codes/*`
- `src/modules/options/*`
- `src/modules/revisions/*`
- `src/modules/workspace/*`
- `src/modules/merge/*`
- `src/modules/message/*`
- `src/modules/commit/*`
- `src/modules/cleanup/*`
- `src/core/events.ts`
- `src/core/models.ts`

职责：

- 提供可单测的原子能力
- 保持 UI 无关

### 3. 共享 Workflow 编排

- `src/workflows/run-workflow.ts`
- `src/workflows/cleanup-workflow.ts`
- 可考虑将 [`src/pipeline.ts`](/d:/svn-merge-tool/src/pipeline.ts) 演进为其中一个 workflow 入口

职责：

- 工作副本预检查
- update
- merge 修订版本
- 构建 summary
- 生成 merge message
- 执行 auto-commit
- 执行 cleanup
- 发出结构化事件

### 4. 输出 Adapters

- `src/output/terminal-renderer.ts`
- `src/output/file-reporter.ts`
- `src/output/web-stream-renderer.ts`
- `src/output/composite-reporter.ts`

职责：

- 将同一份事件渲染到不同输出端
- 保持终端格式化逻辑在核心层之外
- 在 WebUI 中复用同一事件流，同时做结构化展示

## 事件模型草案

核心 workflow 应发出结构化事件，而不是直接写 stdout。

候选事件：

- `run-start`
- `selection-confirmed`
- `precheck-start`
- `precheck-result`
- `update-start`
- `update-result`
- `revision-start`
- `revision-log`
- `revision-conflict`
- `revision-result`
- `summary`
- `merge-message`
- `clipboard-result`
- `commit-start`
- `commit-result`
- `cleanup-start`
- `cleanup-result`
- `run-end`
- `error`

说明：

- 事件应包含显式 level，例如 `info` / `detail` / `warn` / `error`。
- 终端 renderer 决定 `-V` 是否展示详细内容。
- WebUI 可以同时消费粗粒度 section 事件和细粒度 revision 事件。
- 文件日志也必须订阅同一份归一化事件流。
- CLI、文件日志、WebUI 必须是同一份事件流的并行消费者，而不是三条独立日志生成路径。

## 分阶段计划

### 阶段 0：冻结行为

- 记录当前 CLI 与 WebUI 行为
- 区分哪些差异是有意为之，哪些是历史遗留
- 定义重构后的精确行为
- 定义 merge 与 cleanup 的退出码语义
- 定义 WebUI 运行时的终端输出分级策略
- 定义 `svnmerge-ui` 的阻塞式生命周期

交付物：

- 一份确认后的行为矩阵
- 一份迁移检查清单

### 阶段 1：归一化共享选项解析

- 提取 CLI 与 WebUI 共享的选项构建逻辑
- 统一：
  - outputDir
  - ignorePaths
  - verbose
  - autoCommit
  - copyToClipboard
  - language
  - preselected revisions
- 删除重复的修订版本解析逻辑

交付物：

- 一套统一的运行选项构建器
- 一套统一的修订版本表达式解析器

### 阶段 2：建立命令与编排边界

- 定义 `run`、`cleanup`、`ui` 的 command adapter
- 定义 CLI orchestration 与 WebUI orchestration 的职责边界
- 确保命令入口文件只负责组装 workflow 与 adapters

交付物：

- 稳定的命令边界
- 在代码中清晰体现的 orchestration 边界

### 阶段 3：解除核心与终端 IO 的耦合

- 从 [`src/merger.ts`](/d:/svn-merge-tool/src/merger.ts) 中移除直接 `process.stdout.write`
- 将交互式终端提示从 SVN 执行工具中剥离
- 将可重试锁错误从 [`src/svn.ts`](/d:/svn-merge-tool/src/svn.ts) 中抽出，由 orchestration 决定如何处理
- 将 [`src/logger.ts`](/d:/svn-merge-tool/src/logger.ts) 重构为 reporter / output adapter 形态
- 让 workflow 依赖接口，而不是终端副作用

交付物：

- merger 通过事件或 reporter 输出
- SVN helper 不再持有 UI 行为

### 阶段 4：统一 Merge 执行入口

- CLI 改为调用共享 workflow
- CLI 的预览与确认保留在输入阶段
- WebUI 的选择页保留在输入阶段
- 修订版本最终确定后，两端都调用同一个 workflow 入口
- 引入统一语义步骤 `selection confirmed`，其中包含：
  - 最终修订版本集合
  - 最终运行选项

交付物：

- CLI 通过共享 workflow 执行
- WebUI worker 通过不同 output adapter 调用同一个 workflow

### 阶段 5：引入共享 Cleanup 命令

- 将 cleanup 抽取为共享核心动作
- 实现 `svnmerge cleanup`
- 让 WebUI 取消流程复用同一个 cleanup workflow
- 统一 standalone CLI 与 WebUI 触发 cleanup 时的结果与退出码语义

交付物：

- 独立的 cleanup 命令
- CLI 与 WebUI 复用的 cleanup 事件模型

### 阶段 6：强化输出抽象

- 终端简洁 renderer
- `-V` 下的详细终端 renderer
- 文件日志 renderer
- WebUI 的 SSE renderer
- composite renderer，将一份事件流扇出到多个输出端

交付物：

- CLI 普通模式的简洁终端输出
- CLI `-V` 模式的详细终端输出
- WebUI 基于共享事件流渲染页面
- WebUI 在 `-V` 下同步详细输出到终端

### 阶段 7：测试与文档

- 为归一化选项增加行为测试
- 增加 workflow 测试，确保 CLI 与 WebUI 对同一 revision 集合得到相同业务结果
- 为 cleanup 命令增加测试
- 更新 [`README.md`](/d:/svn-merge-tool/README.md) 与 [`README.zh-CN.md`](/d:/svn-merge-tool/README.zh-CN.md)
- 清理过时行为描述

交付物：

- 覆盖两种模式一致性的测试
- 与真实命令行为一致的文档

## 待进一步明确的设计问题

### A. 修订版本选择边界

已确认：

- WebUI 负责手动选择修订版本。
- CLI 不需要手动选择器。

仍需明确：

- CLI 在不传 `-r` 时，仍然自动发现 eligible revisions 并要求确认。
- WebUI 是否支持通过 CLI 参数预选修订版本；即使支持，最终选择权仍留在页面中。

补充：

- 最终确认后，应冻结为一个 `SelectionSnapshot`，后续执行只读取该快照。

### B. WebUI 运行时的终端输出

已确认：

- WebUI 页面负责更友好的展示。
- 终端输出仍有价值。
- 非 `-V` 时，终端仅输出高层状态。
- `-V` 时，终端镜像详细日志。

### C. 确认模型

- CLI 与 WebUI 的确认动作必须代表同一个语义步骤。
- 具体交互控件可以不同，但二者确认的必须是同一份 revision 集合与运行选项。
- 这条边界要明确体现在代码结构和事件流中。

### D. Cleanup 语义

已确认：

- `svnmerge cleanup` 是正式命令，而不是仅用于恢复的辅助动作。
- 不支持 preview / dry-run。
- `cleanup` 提供 `--yes` 跳过确认。

仍需明确：

- `svnmerge cleanup` 是否始终删除未版本化文件？
- CLI 下默认需要确认，传 `--yes` 可跳过。

### E. 对外命令面

已确认：

- `svnmerge run` 是显式的 CLI merge 命令
- `svnmerge` 默认等价于 `svnmerge run`
- `svnmerge cleanup` 是 cleanup 命令
- `svnmerge-ui` 是显式的 WebUI 命令
- `svnmerge ui` 是 `svnmerge-ui` 的别名

仍需明确：

- `svnmerge --help` 应该优先展示 `run` 的帮助，还是先展示命令索引？
- `svnmerge-ui` 与 `svnmerge ui` 是否完全共享同一套参数面？
- `svnmerge-ui` 关闭页面后是否才退出进程：已确认，是。

### F. Auto-Commit 范围

必须验证并保持：

- 只提交真实变更路径
- ignored / reverted 路径不进入 commit
- 未解决的有效冲突阻止 commit
- CLI 与 WebUI 的 summary 和 commit 决策保持完全一致

### G. Dirty Workspace 策略

已确认：

- 发现 dirty workspace 时，merge 必须被阻止。
- CLI 与 WebUI 都不能绕过这条规则继续 merge。

### H. 退出码映射

建议落地为统一模块，例如 `ExitCodeMapper`：

- workflow result -> process exit code
- 所有命令面共用

### I. Cleanup Summary

建议提供结构化 cleanup summary，至少包含：

- revertedCount
- removedCount
- failedCount
- failedItems
- workspaceCleanAfterCleanup

## 风险点

- 从 stdout 直写切换为事件驱动后，容易导致可见行为细节发生变化
- worker-thread + SSE 的集成在事件 schema 不稳定时会增加复杂度
- cleanup 抽离后，可能暴露 WebUI 取消流程中原本隐含的假设
- 当前测试覆盖重点不在“模式一致性”，回归容易漏掉

## 建议实施顺序

1. 锁定行为矩阵
2. 明确对外命令面与别名
3. 统一选项归一化与修订版本解析
4. 定义共享事件源与 reporter 抽象
5. 重构 merger，移除 stdout 直写
6. 迁移 CLI 到共享 workflow
7. 提取 cleanup 命令
8. 将 WebUI 接到共享 cleanup 和共享渲染流
9. 增加 summary 与退出码一致性测试
10. 更新文档

## 开工前可继续头脑风暴的话题

- WebUI 最近一次运行选项应该只存 localStorage，还是也写入 rc 配置
- merge message 是否要重新支持单独导出文件，还是继续只附加到日志末尾
- WebUI 是否要支持“导出修订版本选择”或“复制 revision 表达式”
- 终端与 WebUI 的新增事件文案是否应统一走一套 i18n key
- `svnmerge --help` 是否显示命令索引优先，而不是直接铺开 `run` 帮助

## 本次重构的非目标

- 重新设计冲突解决策略
- 在抽象之外修改 SVN 命令语义
- 引入 `dry-run`
- 重做 WebUI 视觉设计
- 引入远程/服务端部署模式

## 预计会受影响的文件

- [`src/index.ts`](/d:/svn-merge-tool/src/index.ts)
- [`src/webui.ts`](/d:/svn-merge-tool/src/webui.ts)
- [`src/pipeline.ts`](/d:/svn-merge-tool/src/pipeline.ts)
- [`src/merger.ts`](/d:/svn-merge-tool/src/merger.ts)
- [`src/svn.ts`](/d:/svn-merge-tool/src/svn.ts)
- [`src/logger.ts`](/d:/svn-merge-tool/src/logger.ts)
- [`src/types.ts`](/d:/svn-merge-tool/src/types.ts)
- [`README.md`](/d:/svn-merge-tool/README.md)
- [`README.zh-CN.md`](/d:/svn-merge-tool/README.zh-CN.md)
