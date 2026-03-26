# svn-merge-tool 行为矩阵

## 对外命令

| 命令 | 用途 | 说明 |
| --- | --- | --- |
| `svnmerge` | 默认 CLI 合并入口 | 等价于 `svnmerge run` |
| `svnmerge run` | CLI 合并入口 | 主命令行合并命令 |
| `svnmerge cleanup` | 将工作副本恢复为干净状态 | 正式命令，WebUI 取消流程也会复用 |
| `svnmerge-ui` | WebUI 合并入口 | 主浏览器化合并命令 |
| `svnmerge ui` | WebUI 别名 | `svnmerge-ui` 的别名 |

## 核心规则

- 在修订版本最终确定之后，CLI 与 WebUI 共享同一套业务逻辑。
- 手动选择修订版本仅属于 WebUI。
- 对于相同的最终修订版本集合与运行选项，CLI 与 WebUI 必须产出相同的 summary、成功/失败判定和退出码语义。
- 终端输出、文件日志、WebUI 输出都必须来自同一份事件源。
- WebUI 的终端输出策略：
  - `-V`：输出详细终端日志
  - 非 `-V`：仅输出高层终端状态
- `svnmerge-ui` 主进程保持存活，直到网页关闭后再退出。
- dirty workspace 一律阻止 merge。

## 退出码策略

建议所有命令统一采用：

| 场景 | 退出码 |
| --- | --- |
| 命令成功完成 | `0` |
| 命令因业务或运行错误失败 | `1` |
| 用户在执行前取消 | `2` |
| 参数错误或配置错误 | `3` |

说明：

- `run` 与 WebUI merge 必须共用同一套退出码语义。
- `cleanup` 也尽量遵循同一模式。
- 如果后续想减少退出码种类，也只能统一收敛，不能模式间不一致。

## Merge 命令行为矩阵

### 1. 参数 / 配置解析

| 场景 | `svnmerge run` | `svnmerge-ui` | 预期结果 |
| --- | --- | --- | --- |
| 配置解析后仍缺少必需的 `from` | 终端报错 | 打开 UI 前在终端报错 | 非零退出 |
| CLI merge 缺少 `workspace` | 终端报错 | WebUI 如明确支持只读浏览可例外，否则报错 | 实际无法 merge 时必须非零退出 |
| 配置文件路径非法 / YAML 解析失败 | 终端报错 | 打开 UI 前在终端报错 | 非零退出 |
| 未知参数 | 终端报错 | 终端报错 | 非零退出 |

### 2. 修订版本最终确定边界

统一语义步骤：

- 确认最终修订版本集合
- 确认最终运行选项
- 确认开始执行

| 场景 | `svnmerge run` | `svnmerge-ui` | 预期结果 |
| --- | --- | --- | --- |
| 显式传入 `-r` | 解析 revisions，预览，确认 | 如支持可在 UI 中预选，但仍需在页面确认 | 下游共享同一套“最终 revision 集合”语义 |
| 未传 `-r` | 自动发现 eligible revisions，预览，确认 | 用户在页面中手动选择 | 确认后进入同一套共享 workflow |
| 最终未选中任何修订版本 | 用户取消或没有内容可执行 | 页面确认时为空 | 不启动执行流程 |
| 用户在确认前取消 | 以“已取消”结束 | 关闭/取消 UI 流程 | 取消语义保持一致 |

### 3. 工作副本预检查

| 场景 | `svnmerge run` | `svnmerge-ui` | 预期结果 |
| --- | --- | --- | --- |
| 工作副本不是合法 SVN WC | 执行前失败 | 执行前失败 | 非零退出 |
| 工作副本在 merge 前存在脏状态 | 直接阻止 merge | 直接阻止 merge | 业务判定一致，且不得继续 |
| 预检查通过 | 继续执行 | 继续执行 | 进入同一后续步骤 |

说明：

- 交互方式可以不同，但业务判定不能不同。
- 已确认：脏工作副本禁止 merge，两边都必须阻止。

### 4. Update / Merge / Summary / Commit

| 场景 | `svnmerge run` | `svnmerge-ui` | 预期结果 |
| --- | --- | --- | --- |
| `svn update` 成功 | 继续 merge | 继续 merge | workflow 状态一致 |
| `svn update` 失败 | merge 失败 | merge 失败 | summary 分类与退出码一致 |
| merge 全部干净成功 | 干净成功 summary | 干净成功 summary | 统计和最终状态一致 |
| merge 仅存在 ignored 冲突 | summary 一致 | summary 一致 | commit 决策一致 |
| merge 存在有效冲突 | summary 一致 | summary 一致 | commit 同样被阻止 |
| 部分 revisions 失败 | summary 一致 | summary 一致 | commit 同样被阻止 |
| auto-commit 成功 | 成功 | 成功 | 最终结果一致 |
| auto-commit 失败 | 失败 | 失败 | 最终结果分类一致 |

### 5. 终端输出策略

| 场景 | `svnmerge run` | `svnmerge-ui` |
| --- | --- | --- |
| 普通模式 | 简洁终端输出 | 仅高层终端状态 |
| `-V` 详细模式 | 详细终端输出 | 详细终端输出 |
| 文件日志 | 将完整共享事件流渲染到文件 | 将完整共享事件流渲染到文件 |
| Web 页面 | 不适用 | 从同一事件流做更友好的页面展示 |

### 6. 取消语义

| 场景 | `svnmerge run` | `svnmerge-ui` | 预期结果 |
| --- | --- | --- | --- |
| merge 启动前取消 | 以取消结束 | 以取消结束 / 关闭 UI | 不产生 merge 副作用 |
| WebUI merge 执行中取消 | 当前无此能力，除非未来补充 | 中止 run orchestration，然后调用共享 cleanup workflow | cleanup 行为共享 |
| 用户关闭 WebUI 页面 | 主进程在页面关闭后退出 | 主进程退出 | 生命周期符合约定 |

## Cleanup 命令行为矩阵

## 命令身份

- `svnmerge cleanup` 是正式的一等命令。
- WebUI 取消流程复用 cleanup workflow，但不反向定义该命令。

## 目标语义

- 将工作副本恢复为干净状态。
- 这通常意味着：
  - revert 已版本化改动
  - 删除未版本化文件和目录
- 不支持 `dry-run`。

## 仍待拍板的产品问题

| 问题 | 推荐答案 | 原因 |
| --- | --- | --- |
| cleanup 是否删除未版本化文件？ | 是 | “恢复为干净状态”应当按字面落实 |
| cleanup 是否要求 CLI 二次确认？ | 是，支持 `--yes` 跳过 | 操作具有破坏性，同时要保留自动化能力 |
| cleanup 详细路径是否仅在 `-V` 下打印？ | 是 | 与 merge 的 verbose 语义保持一致 |

## Cleanup 执行矩阵

| 场景 | `svnmerge cleanup` | WebUI 触发 cleanup | 预期结果 |
| --- | --- | --- | --- |
| 工作副本有效且 cleanup 完全成功 | 成功 | 成功 | 退出 `0` / 成功结果 |
| 部分路径 revert/remove 失败 | 失败 | 失败 | 非零退出 |
| 工作副本不存在或非法 | 失败 | 失败 | 非零退出 |
| 用户在确认前取消 | 已取消 | UI 中可视需求决定 | 如存在取消语义，则保持一致 |

## 事件源要求

所有命令面都必须消费同一套 workflow 事件。

建议的 merge 事件族：

- selection confirmed
- precheck
- update
- revision merge
- summary
- merge message
- clipboard
- auto-commit
- run end

建议所有事件带 `level` 字段：

- `info`
- `detail`
- `warn`
- `error`

建议的 cleanup 事件族：

- cleanup start
- reverted path
- removed path
- failed path
- cleanup summary
- cleanup end

## 建议验证清单

- 相同的最终 revisions + options，在 CLI 与 WebUI 下得到相同 summary
- 相同的最终 revisions + options，在 CLI 与 WebUI 下得到相同 commit 决策
- 相同的 merge 失败场景，对应相同退出码语义
- 相同的 cleanup 失败场景，对应相同退出码语义
- 终端 / 文件 / WebUI 的差异仅在渲染层，不在事件语义层
