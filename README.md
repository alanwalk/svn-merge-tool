# svn-merge-tool

[中文文档](README.zh-CN.md)

A CLI tool for merging specific SVN revisions one by one, with automatic conflict resolution, ignore rules, and merge message generation.

## Features

- Merge revisions individually (`svn merge -c`) with automatic conflict resolution
- **Text / Property conflicts** → accept incoming (`theirs-full`)
- **Tree conflicts** → keep local (`working`)
- **Ignore rules** — paths matching `ignore-merge` patterns are always discarded (reverted), even when they produce no conflict
- Minimal console progress with color-coded results; full details streamed to `svn-merge-tool.log`
- Generates `svn-merge-message.txt` with compressed revision range + `svn log` bodies
- Pre-merge `svn update` and dirty working-copy check with `[y/N]` prompt
- YAML config file with auto-discovery walking up from `cwd`

## Installation

```bash
git clone https://github.com/<you>/svn-merge-tool.git
cd svn-merge-tool
npm install
npm link          # makes `svn-merge-tool` available globally
```

> Requires Node.js ≥ 18 and `svn` on PATH.

## Usage

```
svn-merge-tool [options]

Options:
  -c, --config <path>       Path to YAML config file
  -w, --workspace <path>    SVN working copy directory
  -f, --from-url <url>      Source branch URL to merge from
  -r, --revisions <list>    Revisions or ranges, e.g. 1001,1002-1005,1008  (required)
  -V, --version             Output version number
  -h, --help                Display help
```

### Examples

```bash
# Auto-discover svn-merge-tool.yaml from cwd upward
svn-merge-tool -r 84597-84608,84610

# Explicit config file
svn-merge-tool -c ./svn.yaml -r 84597-84608,84610

# All options on the command line
svn-merge-tool -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001,1002

# Override workspace from config
svn-merge-tool -c ./svn.yaml -w /path/to/override -r 1001,1002,1003
```

## Config File

The tool searches for `svnmerge.yaml` (or `.yml`) starting from the current directory and walking up to the filesystem root.

```yaml
workspace: /path/to/working-copy
fromUrl: http://svn.example.com/branches/feature
outputDir: /logs/svn          # optional
ignoreMerge:
  - src/thirdparty/generated
  - assets/auto-generated/catalog.json
```

| Key           | Description                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `workspace`   | Path to the SVN working copy                                                                                  |
| `fromUrl`     | Source branch URL                                                                                             |
| `outputDir`   | Directory for output files. Absolute path or relative to workspace. Defaults to `.svnmerge/` under workspace. |
| `ignoreMerge` | List of workspace-relative paths (files or folders) to always discard                                         |

Command-line options `-w` and `-f` override the config file values.

## Output

### Console (per revision)

```
[1/13] r84597  8%  (2 conflict(s), 2 ignored)
  [TREE    ][F]  src/gameplay/module/FooSystem.lua  (working)
  [TREE    ][F]  src/gameplay/module/BarSystem.lua  (working)
  [TEXT    ][F]  src/thirdparty/generated/hero/buff.xlsx  (ignored)
  [NONE    ][F]  src/thirdparty/generated/hero/skill.xlsx  (reverted)
[2/13] r84598  15%  ✓
```

### Conflict Summary (after all revisions)

```
Conflict Summary:
  Tree Conflicts (2 + 7 ignored):
    [F]  src/gameplay/module/FooSystem.lua  (working)
    [F]  src/gameplay/module/BarSystem.lua  (working)
    [D]  src/thirdparty/generated/environment/dev  (ignored)
    ...
  Text Conflicts (0 + 2 ignored):
    [F]  src/thirdparty/generated/hero/buff.xlsx  (ignored)
    [F]  src/thirdparty/generated/hero/skill.xlsx  (ignored)
  Reverted (3 Ignored):
    [F]  src/thirdparty/generated/hero/illustration.xlsx  (reverted)
    ...
```

### Output Files

Both files are written to the `outputDir` (default: `.svnmerge/` under workspace).

| File                         | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `yyyymmddhhmmss-log.txt`     | Full merge log, streamed in real time                         |
| `yyyymmddhhmmss-message.txt` | Commit message — compressed revision range + `svn log` bodies |

## Conflict Resolution Rules

| Conflict Type                            | Behavior                                        |
| ---------------------------------------- | ----------------------------------------------- |
| Tree conflict                            | `svn resolve --accept working`                  |
| Text conflict                            | `svn resolve --accept theirs-full`              |
| Property conflict                        | `svn resolve --accept theirs-full`              |
| Ignored path (any conflict)              | Override → `working`, displayed in gray         |
| Ignored path (no conflict, but modified) | `svn revert`, displayed in gray as `(reverted)` |

## Tech Stack

- TypeScript 5.5 + ts-node 10.9 (runs directly, no compile step needed)
- [commander](https://github.com/tj/commander.js) — CLI argument parsing
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML config parsing

## Changelog

### 1.0.3
- YAML config keys renamed to camelCase: `fromUrl`, `outputDir`, `ignoreMerge`
- `outputDir` config field: customize output directory for `svn-merge-tool.log` and `svn-merge-message.txt`
- `-r` is now optional: omit to merge all eligible revisions (`svn mergeinfo --show-revs eligible`), with confirmation prompt
- Path examples in docs/help text changed to Unix style

### 1.0.2
- `-v / --verbose` flag: ignored and reverted file details are now hidden by default; pass `-v` to show them in the console
- Tree conflicts now display in **red**; text/property conflicts in yellow
- Conflict Summary is written to `svn-merge-tool.log` at the end of each run
- `svn-merge-tool.log` and `svn-merge-message.txt` are now generated inside the workspace directory (not cwd)

### 1.0.1
- Fix: `bin` path in `package.json` was invalid (`./` prefix removed)

### 1.0.0
- Initial release
- Per-revision merge with automatic conflict resolution
- YAML config file with `ignore-merge` path list
- Real-time log file streaming
- Merge message file generation
- Pre-merge `svn update` and dirty working-copy check

## License

MIT
