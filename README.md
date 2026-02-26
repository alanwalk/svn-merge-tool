# svn-merge-tool

[中文文档](README.zh-CN.md)

A CLI tool for merging specific SVN revisions one by one, with automatic conflict resolution, ignore rules, and merge message generation.

## Features

- Merge revisions individually (`svn merge -c`) with automatic conflict resolution
- **Text / Property conflicts** → accept incoming (`theirs-full`)
- **Tree conflicts** → keep local (`working`)
- **Ignore rules** — paths matching `ignore-merge` patterns are always discarded (reverted), even when they produce no conflict
- `--dry-run` mode — preview eligible revisions and their log messages without making any changes
- `-C, --commit` — automatically run `svn commit` after a successful merge, using the generated message file as the commit log
- Minimal console progress with color-coded results; full details streamed to `svnmerge-<timestamp>.log`
- Commit message (revision range + `svn log` bodies) appended to the log file at the end of each run
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
  -f, --from <url>         Source branch URL to merge from
  -r, --revisions <list>    Revisions or ranges, e.g. 1001,1002-1005,1008
  -o, --output <path>       Output directory for log and message files (overrides config)
  -i, --ignore <paths>      Comma-separated paths to ignore (appended to config ignore list)
  -V, --verbose             Show ignored/reverted file details in console output
  -d, --dry-run             List eligible revisions and their log messages, no merge
  -C, --commit              Auto svn commit after successful merge (uses generated message file)
  -v, --version             Output version number
  -h, --help                Display help
```

### Examples

```bash
# Auto-discover svnmerge.yaml from cwd upward
svn-merge-tool -r 84597-84608,84610

# Preview eligible revisions without merging
svn-merge-tool -d
svn-merge-tool -d -r 84597-84610

# Merge and auto-commit using the generated message file
svn-merge-tool -r 1001 -C

# Ignore specific paths on the command line (appended to config ignore list)
svn-merge-tool -r 1001 -i src/thirdparty/generated,assets/auto

# Custom output directory
svn-merge-tool -r 1001 -o /logs/svn

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
from: http://svn.example.com/branches/feature
output: /logs/svn             # optional
commit: true                  # optional: auto svn commit after successful merge
verbose: false                # optional: show ignored/reverted details (same as -V)
ignore:
  - src/thirdparty/generated
  - assets/auto-generated/catalog.json
```

| Key         | Description                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `workspace` | Path to the SVN working copy                                                                                     |
| `from`      | Source branch URL (same as `-f`)                                                                                 |
| `output`    | Directory for output files. Absolute path or relative to workspace. Defaults to `.svnmerge/` under workspace.    |
| `commit`    | Set to `true` to automatically run `svn commit` after a successful merge (same as `-C`)                          |
| `verbose`   | Set to `true` to show ignored/reverted file details in console (same as `-V`)                                    |
| `ignore`    | List of workspace-relative paths (files or folders) to always discard. CLI `-i` paths are appended to this list. |

Command-line options `-w`, `-f`, `-o`, `-V`, `-C` override the corresponding config file values.

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

The log file is written to the `output` directory (default: `.svnmerge/` under workspace).

| File                        | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `svnmerge-yyyymmddhhmmss.log` | Full merge log streamed in real time, with the commit message block appended at the end |

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

### 1.0.7
- Log file renamed from `yyyymmddhhmmss-log.txt` to `svnmerge-yyyymmddhhmmss.log`
- Commit message is now appended to the log file instead of a separate `message.txt`

### 1.0.6
- `-f, --from` replaces `-f, --from-url` (shorter long flag)
- YAML key `fromUrl` renamed to `from`
- YAML key `outputDir` renamed to `output`
- YAML key `ignoreMerge` renamed to `ignore`

### 1.0.5
- `--commit` flag and `commit: true` config key: automatically run `svn commit` after a successful merge, using the generated `message.txt` as the commit log
- YAML key renamed from `autoCommit` to `commit` to match the CLI flag
- Commit is skipped if there are any failures or unresolved conflicts

### 1.0.4
- `--dry-run` flag: preview eligible revisions and their log messages without making any changes
- Config file renamed from `svn-merge-tool.yaml` to `svnmerge.yaml`
- `verbose: true` config key: mirror of the `-v` flag
- Output filenames now include a timestamp prefix (`yyyymmddhhmmss-log.txt`, `yyyymmddhhmmss-message.txt`)

### 1.0.3
- YAML config keys renamed to camelCase: `fromUrl`, `outputDir`, `ignoreMerge`
- `outputDir` config field: customize output directory for log and message files
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
