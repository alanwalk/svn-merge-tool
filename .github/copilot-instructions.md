# GitHub Copilot — svn-merge-tool 工作区指令

## 项目概述

**svn-merge-tool** 是一个 Node.js CLI 工具，用于逐个合并 SVN 分支的特定修订版本，并自动处理冲突解决。发布到 npm，命令别名为 `svn-merge-tool` / `svnmerge`。

- **语言**：TypeScript 5.5（严格模式）
- **运行时**：Node.js ≥ 18
- **依赖**：commander.js（CLI）、js-yaml（配置解析）

---

## 构建与开发命令

```bash
npm start           # 开发运行（ts-node src/index.ts）
npm run build       # 编译 TypeScript → dist/
npm run lint        # 类型检查（tsc --noEmit，无输出）
npm run prepublishOnly  # lint + build，发布前自动运行
```

> **环境要求**：`svn` 命令必须在 PATH 中可用，Node.js ≥ 18。

---

## 架构与文件职责

```
bin/svn-merge-tool.js   — 入口 shebang，加载 dist/index.js（已编译）
src/
  index.ts    — CLI 入口（commander）；参数解析、验证、流程编排、冲突汇总显示
  merger.ts   — 核心合并循环：mergeRevision() + run()
  svn.ts      — 所有 SVN 命令的同步封装（spawnSync）
  types.ts    — 共享接口：MergeOptions、ConflictInfo、RevisionMergeResult、MergeSummary
  config.ts   — YAML 配置加载；findDefaultConfig() 向上遍历目录查找 svnmerge.yaml
  logger.ts   — 带时间戳的日志文件写入器；appendRaw() 追加原始内容
  message.ts  — buildMessage()：生成格式化的提交消息字符串
  updater.ts  — npm 版本检查；管理 ~/.svnmergerc 状态文件
  utils.ts    — isIgnored()、compressRevisions()、groupSummaryByType()、relPath() 等辅助函数
```

### 数据流
`index.ts` → `config.ts`（加载配置）→ `merger.ts`（逐版本合并）→ `svn.ts`（执行 SVN 命令）→ `utils.ts`（路径/冲突处理）→ `logger.ts`（记录日志）→ `message.ts`（生成提交消息）

---

## 关键设计决策

### 冲突解决策略
- **文本/属性冲突** → `--accept theirs-full`（保留来源分支的更改）
- **树冲突** → `--accept working`（保留本地更改）
- **忽略路径** → 始终以 `working` 解决并还原（`svn revert`）

### 自动提交门控逻辑（重要）
`ConflictInfo` 有两个不同字段：
- `ignored: boolean` — 路径匹配 ignore 列表 → **允许**自动提交（这是唯一的门控条件）
- `resolved: boolean` — `svnResolve()` 调用成功 → **不影响**自动提交（仅用于日志）

> **关键**：修改自动提交逻辑时，务必基于 `c.ignored`，而非 `c.resolved`。

### 配置优先级
CLI 参数 > YAML 配置文件 > 默认值

YAML 配置文件向上遍历目录查找 `svnmerge.yaml` / `svnmerge.yml`，路径相对于配置文件所在目录解析。

### SVN 命令执行
- 全部使用 `spawnSync`，同步操作（无 async/await）
- Windows GBK 编码检测：若 UTF-8 解码含替换字符，则回退到 latin1 二进制
- 日志批量拉取：每批 200 个修订版本，防止缓冲区溢出

---

## 编码约定

- TypeScript 严格模式，`types.ts` 中为所有主要数据流定义接口，无隐式 any
- 控制台输出：带 ANSI 颜色码（RED/YELLOW/GREEN/CYAN）实时进度展示
- 文件日志：每条消息带时间戳，ANSI 代码已剥离，末尾追加原始合并消息
- 关键错误抛出异常（在 CLI 层捕获并彩色显示），次要操作（如剪贴板）静默失败
- 路径统一使用正斜杠输出；忽略匹配大小写不敏感（Windows）

---

## 提交与版本控制规则

1. **每次功能性代码修改后自动 git commit**：`git add -A && git commit -m "<描述>"`
2. **绝不**自动运行 `git push`，由用户手动推送
3. **绝不**自主修改版本号（`package.json`、`src/index.ts`），版本由用户控制
4. **绝不**创建 Markdown 文档文件记录变更，除非用户明确要求

---

## 常见陷阱

| 问题 | 说明 |
|------|------|
| SVN 不在 PATH | 第一个 svn 命令即失败，报 "Failed to spawn svn" |
| 工作副本非根目录 | `svn info` 会验证；子目录会报错 |
| 树冲突指向已删除路径 | 用扩展名启发式判断是否为目录（无扩展名 = 目录） |
| 超大修订集 | 已分批（200个/批）拉取日志，不要改为单次拉取 |
| Windows MAX_PATH | 不支持超 260 字符的路径，无特殊处理 |
| RC 文件写入失败 | `~/.svnmergerc` 创建失败时静默使用默认值 |
