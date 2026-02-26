# svn-merge-tool

[English](README.md)

逐条合并指定 SVN 修订版本的 CLI 工具，支持自动冲突解决、忽略规则和合并提交信息生成。

## 功能特性

- 逐条执行 `svn merge -c`，自动解决冲突
- **文本 / 属性冲突** → 接受对方修改（`theirs-full`）
- **树冲突** → 保留本地版本（`working`）
- **忽略规则** — 匹配 `ignore-merge` 的路径始终丢弃（revert），即使没有产生冲突
- `--dry-run` 模式 — 预览待合并的修订版本及其日志，不执行任何实际修改
- `--commit` — 合并成功后自动执行 `svn commit`，以生成的 message.txt 内容作为提交日志
- 控制台仅显示精简进度（带颜色），完整日志实时写入 `svnmerge-<时间戳>.log`
- 提交信息（修订版本范围 + `svn log` 正文）追加到日志文件末尾
- 合并前自动执行 `svn update`，检测工作副本脏状态并提示 `[y/N]`
- 支持 YAML 配置文件，从当前目录向上自动查找

## 安装

```bash
npm install -g svn-merge-tool
```

> 需要 Node.js ≥ 18 且 `svn` 在 PATH 中可用。

### 从源码安装（开发模式）

```bash
git clone https://github.com/<you>/svn-merge-tool.git
cd svn-merge-tool
npm install
npm link
```

## 用法

```
svn-merge-tool [选项]

选项:
  -c, --config <path>       YAML 配置文件路径
  -w, --workspace <path>    SVN 工作副本目录
  -f, --from <url>         合并来源分支 URL
  -r, --revisions <list>    修订版本或范围，例如 1001,1002-1005,1008
  -o, --output <path>       输出文件目录（覆盖配置中的 output）
  -i, --ignore <paths>      逗号分隔的忽略路径（追加到配置的 ignore 列表）
  -V, --verbose             在控制台显示 ignored/reverted 文件详情
  -d, --dry-run             列出待合并修订版本及日志，不执行合并
  -C, --commit              合并成功后自动执行 svn commit（使用生成的 message.txt）
  -v, --version             显示版本号
  -h, --help                显示帮助
```

### 示例

```bash
# 自动向上查找 svnmerge.yaml
svn-merge-tool -r 84597-84608,84610

# 预览待合并修订版本，不执行合并
svn-merge-tool -d
svn-merge-tool -d -r 84597-84610

# 合并后自动提交，使用生成的 message 文件作为日志
svn-merge-tool -r 1001 -C

# 命令行传入忽略路径（追加到配置文件的 ignore 列表）
svn-merge-tool -r 1001 -i src/thirdparty/generated,assets/auto

# 指定配置文件
svn-merge-tool -c ./svn.yaml -r 84597-84608,84610

# 全部通过命令行参数指定
svn-merge-tool -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001,1002

# 覆盖配置文件中的 workspace
svn-merge-tool -c ./svn.yaml -w /path/to/override -r 1001,1002,1003

# 显示忽略/还原文件详情
svn-merge-tool -V -r 1001,1002
```

## 配置文件

工具从当前目录开始向上查找 `svnmerge.yaml`（或 `.yml`）。

```yaml
workspace: /path/to/working-copy
from: http://svn.example.com/branches/feature
output: /logs/svn             # 可选
commit: true                  # 可选：合并成功后自动 svn commit
verbose: false                # 可选：显示 ignored/reverted 详情（等同于 -V）
ignore:
  - src/thirdparty/generated
  - assets/auto-generated/catalog.json
```

| 字段        | 说明                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| `workspace` | SVN 工作副本路径                                                                           |
| `from`      | 合并来源分支 URL（等同于 `-f`）                                                            |
| `output`    | 输出文件目录。绝对路径或相对于 workspace 的路径，默认为 workspace 下的 `.svnmerge/` 目录。 |
| `commit`    | 设为 `true` 则合并成功后自动执行 `svn commit`（等同于 `-C`）                               |
| `verbose`   | 设为 `true` 则在控制台显示 ignored/reverted 文件详情（等同于 `-V`）                        |
| `ignore`    | 需要始终丢弃的工作副本相对路径（文件或目录）。`-i` 传入的路径会追加到此列表。              |

命令行选项 `-w`、`-f`、`-o`、`-V`、`-C` 会覆盖配置文件中的对应值。

## 输出说明

### 控制台（每条修订）

```
[1/13] r84597  8%  (2 conflict(s))
  [TREE    ][F]  src/gameplay/module/FooSystem.lua  (working)
  [TREE    ][F]  src/gameplay/module/BarSystem.lua  (working)
[2/13] r84598  15%  ✓
```

加上 `-v` 后还会显示忽略/还原条目（灰色）：

```
[1/13] r84597  8%  (2 conflict(s), 2 ignored)
  [TREE    ][F]  src/gameplay/module/FooSystem.lua  (working)
  [TEXT    ][F]  src/thirdparty/generated/hero/buff.xlsx  (ignored)
  [NONE    ][F]  src/thirdparty/generated/hero/skill.xlsx  (reverted)
```

### 冲突汇总（所有修订完成后）

```
Conflict Summary:
  Tree Conflicts (2):
    [F]  src/gameplay/module/FooSystem.lua  (working)
    [F]  src/gameplay/module/BarSystem.lua  (working)
```

加上 `-v` 后还会显示 ignored / Reverted 分组。

### 输出文件

日志文件写入 `output` 目录（默认为 workspace 下的 `.svnmerge/` 目录）。

| 文件                          | 说明                                       |
| ----------------------------- | ------------------------------------------ |
| `svnmerge-yyyymmddhhmmss.log` | 完整合并日志实时写入，提交信息块追加在最后 |

## 冲突解决规则

| 冲突类型                   | 处理方式                                       |
| -------------------------- | ---------------------------------------------- |
| 树冲突                     | `svn resolve --accept working`（保留本地）     |
| 文本冲突                   | `svn resolve --accept theirs-full`（接受对方） |
| 属性冲突                   | `svn resolve --accept theirs-full`（接受对方） |
| 忽略路径（有冲突）         | 强制改为 `working`，灰色显示                   |
| 忽略路径（无冲突但有修改） | `svn revert`，灰色显示为 `(reverted)`          |

## 技术栈

- TypeScript 5.5 + ts-node 10.9（直接运行，无需预编译）
- [commander](https://github.com/tj/commander.js) — CLI 参数解析
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML 配置解析

## 更新日志

### 1.0.4
- `-d, --dry-run`：预览待合并修订版本及日志，不执行合并
- `-i, --ignore <paths>`：命令行传入忽略路径（逗号分隔），追加到配置的 `ignore` 列表
- `-C, --commit` / `commit: true`：合并成功后自动 `svn commit`，使用生成的提交信息
- 短标志调整：`-V` 改为 `--verbose`，`-v` 改为 `--version`
- `-f, --from` 替代 `--from-url`；YAML 键重命名：`fromUrl`→`from`、`outputDir`→`output`、`ignoreMerge`→`ignore`
- 配置文件名从 `svn-merge-tool.yaml` 改为 `svnmerge.yaml`
- 日志文件改名为 `svnmerge-yyyymmddhhmmss.log`；提交信息追加到日志末尾，不再单独生成 `message.txt`

### 1.0.3
- YAML 配置字段重命名为小驼峰格式：`fromUrl`、`outputDir`、`ignoreMerge`
- 新增 `outputDir` 配置字段：自定义 `svn-merge-tool.log` 和 `svn-merge-message.txt` 的输出目录
- `-r` 参数改为可选：不传时自动查询所有 eligible 修订版本（`svn mergeinfo --show-revs eligible`）并提示确认后合并
- 文档和帮助文本中的路径示例改为 Unix 风格

### 1.0.2
- 新增 `-v / --verbose` 参数：ignored 和 reverted 文件详情默认不显示，加 `-v` 才输出到控制台
- 树冲突以**红色**显示，文本/属性冲突以黄色显示
- 冲突汇总现在同步写入 `svn-merge-tool.log`
- `svn-merge-tool.log` 和 `svn-merge-message.txt` 生成在 workspace 目录下（而非 cwd）

### 1.0.1
- 修复：`package.json` 中 `bin` 路径多余的 `./` 前缀

### 1.0.0
- 初始版本
- 逐条修订合并并自动解决冲突
- YAML 配置文件支持 `ignore-merge` 列表
- 实时日志流写入
- 合并信息文件生成
- 合并前 `svn update` 和脏状态检查

## License

MIT
