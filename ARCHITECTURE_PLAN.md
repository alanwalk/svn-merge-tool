# svn-merge-tool 架构方案

## 目标

重构后的工具应满足：

- 业务逻辑共享
- workflow 编排共享
- 命令入口足够薄
- CLI 与 WebUI 仅在 orchestration 与渲染层存在差异

## 分层模型

### 1. Command Entry Layer

目的：

- 对外暴露命令
- 解析顶层命令选择
- 组装 orchestration 与 adapters
- 不承载业务规则

建议文件：

- `src/index.ts`
- `src/bin/svnmerge-ui.ts` 或等价的 UI bin 入口
- `src/commands/run.ts`
- `src/commands/cleanup.ts`
- `src/commands/ui.ts`

职责：

- 将 `svnmerge` 映射到 `run`
- 将 `svnmerge ui` 映射为 UI 命令别名
- 将 `svnmerge-ui` 映射到同一套 UI command 实现
- 用正确的 adapters 实例化 orchestration
- 不在 command entry 中直接 `process.exit(...)` 业务结果，而是通过统一退出码映射层处理

### 2. Orchestration Layer

目的：

- 将不同的输入方式和输出方式桥接到共享 workflow
- 承担模式专属的交互行为

建议文件：

- `src/orchestration/cli/run-orchestration.ts`
- `src/orchestration/cli/cleanup-orchestration.ts`
- `src/orchestration/webui/ui-orchestration.ts`
- `src/orchestration/webui/merge-session.ts`

职责：

CLI orchestration：

- 终端提示
- 明确的 revision 预览与确认
- 对最终运行选项进行确认
- 根据 `-V` 选择终端 renderer

WebUI orchestration：

- 启动/打开服务
- 修订版本浏览与选择
- 在页面中确认最终 revisions 与运行选项
- 保持主进程存活，直到页面关闭
- 选择终端输出策略：
  - `-V`：详细
  - 非 `-V`：高层
- 将 workflow 事件桥接到 SSE / 页面

不负责：

- merge 业务规则
- cleanup 业务规则
- commit 决策逻辑

### 3. 共享 Workflow Layer

目的：

- 定义正式的业务执行流程

建议文件：

- `src/workflows/run-workflow.ts`
- `src/workflows/cleanup-workflow.ts`
- `src/workflows/types.ts`

职责：

Run workflow：

- 接收最终 revisions 与最终运行选项
- 仅接收冻结后的 `SelectionSnapshot`
- 发出 `selection-confirmed`
- 执行预检查
- 更新工作副本
- merge 修订版本
- 产出 summary
- 生成 merge message
- 在启用时复制到剪贴板
- 执行或跳过 auto-commit
- 最终产出归一化结果与退出状态分类

Cleanup workflow：

- 校验工作副本
- 假定 orchestration 已完成确认
- revert 已版本化修改
- 删除未版本化文件
- 产出归一化 cleanup summary
- 最终产出归一化结果与退出状态分类

### 4. 共享原子模块

目的：

- 提供独立、可测试的原子能力

建议文件：

- `src/modules/config/resolve-command-config.ts`
- `src/modules/exit-codes/map-exit-code.ts`
- `src/modules/options/build-run-options.ts`
- `src/modules/options/build-cleanup-options.ts`
- `src/modules/revisions/parse-revision-expression.ts`
- `src/modules/revisions/finalize-revisions.ts`
- `src/modules/workspace/check-workspace.ts`
- `src/modules/workspace/check-dirty.ts`
- `src/modules/workspace/update-workspace.ts`
- `src/modules/merge/run-merge.ts`
- `src/modules/merge/build-summary.ts`
- `src/modules/message/build-merge-message.ts`
- `src/modules/commit/run-auto-commit.ts`
- `src/modules/cleanup/run-cleanup.ts`
- `src/modules/platform/copy-to-clipboard.ts`

职责：

- 一个模块只做一个能力
- 尽可能保持确定性
- 不写终端格式化
- 不写 SSE 逻辑
- 不写页面逻辑

### 5. Event / Model Layer

目的：

- 为 workflow 与 renderer 提供共享语言

建议文件：

- `src/core/events.ts`
- `src/core/models.ts`
- `src/core/exit-codes.ts`

建议模型：

- `RunOptions`
- `CleanupOptions`
- `SelectionSnapshot`
- `RunSummary`
- `CleanupSummary`
- `WorkflowResult`
- `ExitClassification`

建议事件族：

- selection
- precheck
- update
- merge
- summary
- message
- clipboard
- commit
- cleanup
- workflow end
- error

建议所有事件至少包含：

- `type`
- `level`
- `timestamp`
- `payload`

### 6. Output Adapter Layer

目的：

- 将同一份事件以不同形式渲染到终端、文件日志和浏览器

建议文件：

- `src/output/terminal/detailed-terminal-renderer.ts`
- `src/output/terminal/summary-terminal-renderer.ts`
- `src/output/file/file-log-renderer.ts`
- `src/output/webui/sse-renderer.ts`
- `src/output/composite-renderer.ts`

职责：

- 订阅共享 workflow 事件
- 只负责渲染，不做业务决策

组合示例：

CLI run：

- `-V` 时使用详细终端 renderer
- 否则使用简洁终端 renderer
- 始终启用 file renderer

WebUI run：

- `-V` 时使用详细终端 renderer
- 否则使用高层终端 renderer
- 始终启用 file renderer
- 始终启用 SSE renderer

Cleanup run：

- 根据 verbosity 选择终端 renderer
- 如需要，也可以写 file renderer

补充建议：

- cleanup renderer 也应支持结构化 summary 展示，而不仅是文本行

## 建议数据流

### CLI Merge

1. command entry 解析 `run`
2. CLI orchestration 解析配置和原始选项
3. CLI orchestration 最终确定 revisions 并确认运行选项
4. orchestration 组装 output adapters
5. orchestration 调用共享 `runWorkflow`
6. workflow 发出事件
7. adapters 渲染事件
8. orchestration 将 workflow 结果映射为进程退出码

说明：

- 退出码映射建议统一通过 `ExitCodeMapper` 或等价模块完成

### WebUI Merge

1. command entry 解析 UI 命令
2. WebUI orchestration 解析配置和原始选项
3. UI 服务/页面让用户浏览并选择 revisions
4. 页面确认最终 revisions 与运行选项
5. orchestration 组装 terminal + file + SSE adapters
6. orchestration 调用共享 `runWorkflow`
7. workflow 发出事件
8. adapters 渲染事件
9. orchestration 将 workflow 结果映射为进程退出码

### Cleanup

1. command entry 解析 `cleanup`
2. orchestration 解析 workspace 与选项
3. orchestration 在需要时做确认
4. orchestration 组装 adapters
5. orchestration 调用共享 `cleanupWorkflow`
6. workflow 发出事件
7. adapters 渲染事件
8. orchestration 将 workflow 结果映射为进程退出码

## 测试策略

### 单元测试

- revision parser
- 选项归一化
- cleanup 路径分类
- commit 决策规则
- 退出码映射

### Workflow 测试

- 同一个 selection snapshot 得到相同 run summary
- 同一个失败输入得到相同退出状态分类
- cleanup workflow 的成功/失败路径
- dirty workspace 必须阻止 merge

### Adapter 测试

- terminal renderer 的格式化
- SSE 事件映射
- file renderer 写出内容

### Command / Orchestration 测试

- `svnmerge` 默认映射到 `run`
- `svnmerge ui` 是 `svnmerge-ui` 的别名
- CLI 确认路径
- WebUI 确认路径

## 迁移说明

当前最可能的迁移目标：

- [`src/index.ts`](/d:/svn-merge-tool/src/index.ts) 转为 command bootstrap，不再主导业务流程
- [`src/webui.ts`](/d:/svn-merge-tool/src/webui.ts) 需要拆成 UI orchestration 与 Web 资源/服务逻辑
- [`src/pipeline.ts`](/d:/svn-merge-tool/src/pipeline.ts) 可被提升或替换为共享 workflow 文件
- [`src/merger.ts`](/d:/svn-merge-tool/src/merger.ts) 必须停止直接写 `stdout`
- [`src/svn.ts`](/d:/svn-merge-tool/src/svn.ts) 不应继续持有终端交互行为

## 需要长期保护的架构规则

- 命令入口文件不实现业务规则
- workflow 不知道自己运行在 CLI 还是 WebUI 下
- 原子模块不直接写终端
- renderer 不参与业务决策
- 一份事件源驱动所有输出通道
- 一份最终确定的 selection snapshot 同时驱动 CLI 与 WebUI 执行
- dirty workspace 规则由共享 workflow 统一执行，不允许模式专属绕过
