# svn-merge-tool

[中文文档](README.zh-CN.md)

A CLI tool for merging specific SVN revisions one by one, with automatic conflict resolution, ignore rules, and merge message generation.

## Features

- Merge revisions individually (`svn merge -c`) with automatic conflict resolution
- **Text / Property conflicts** → accept incoming (`theirs-full`)
- **Tree conflicts** → keep local (`working`)
- **Ignore rules** — paths matching `ignore-merge` patterns are always discarded (reverted), even when they produce no conflict
- `-C, --commit` — automatically run `svn commit` after a successful merge, using the generated message file as the commit log
- Minimal console progress with color-coded results; full details streamed to `svnmerge-<timestamp>.log`
- `svnmerge-ui` — dedicated WebUI entry; `svnmerge ui` is a compatible alias
- `svnmerge cleanup` — restore the workspace to a clean state
- Commit message (revision range + `svn log` bodies) appended to the log file at the end of each run
- Dirty working copies are blocked before merge; use `svnmerge cleanup` after review if you want to reset them
- YAML config file with auto-discovery walking up from `cwd`

## Installation

```bash
git clone https://github.com/<you>/svn-merge-tool.git
cd svn-merge-tool
npm install
npm link          # makes `svnmerge` available globally
```

> Requires Node.js ≥ 18 and `svn` on PATH.

## Usage

```bash
svnmerge --help

Commands:
  svnmerge run [options]
  svnmerge cleanup [options]
  svnmerge ui [options]
  svnmerge-ui [options]
```

### `svnmerge run`

```bash
svnmerge run [options]

Options:
  -c, --config <path>       Path to YAML config file
  -w, --workspace <path>    SVN working copy directory
  -f, --from <url>          Source branch URL to merge from
  -r, --revisions <list>    Revisions or ranges, e.g. 1001,1002-1005,1008
  -o, --output <path>       Output directory for log and message files
  -i, --ignore <paths>      Comma-separated paths to ignore
  -V, --verbose             Show ignored/reverted file details in console output
  -C, --commit              Auto svn commit after successful merge
```

`svnmerge` without a subcommand defaults to `svnmerge run`.

### `svnmerge cleanup`

```bash
svnmerge cleanup [options]

Options:
  -c, --config <path>       Path to YAML config file
  -w, --workspace <path>    SVN working copy directory
  -V, --verbose             Show cleanup details in console output
  -y, --yes                 Skip confirmation prompt
```

### `svnmerge-ui` / `svnmerge ui`

```bash
svnmerge-ui [options]
svnmerge ui [options]

Options:
  -f, --from <url>          Source branch URL
  -w, --workspace <path>    SVN working copy directory
  -c, --config <path>       YAML config file
  -r, --revisions <list>    Preselect revisions/ranges
  -i, --ignore <paths>      Comma-separated paths to ignore
  -o, --output <path>       Output directory for log file
  -V, --verbose             Show ignored/reverted details
  -C, --commit              Auto-commit after successful merge
      --copy-to-clipboard   Force enable merge-message clipboard copy
      --no-copy-to-clipboard Force disable merge-message clipboard copy
```

### Examples

```bash
# Auto-discover svnmerge.yaml from cwd upward
svnmerge run -r 84597-84608,84610

# Merge and auto-commit using the generated message file
svnmerge run -r 1001 -C

# Ignore specific paths on the command line (appended to config ignore list)
svnmerge run -r 1001 -i src/thirdparty/generated,assets/auto

# Custom output directory
svnmerge run -r 1001 -o /logs/svn

# Explicit config file
svnmerge run -c ./svn.yaml -r 84597-84608,84610

# All options on the command line
svnmerge run -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001,1002

# Override workspace from config
svnmerge run -c ./svn.yaml -w /path/to/override -r 1001,1002,1003

# Open WebUI
svnmerge-ui -c ./svn.yaml

# Clean workspace after review
svnmerge cleanup -w /path/to/copy
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
  [NONE    ][F]  src/thirdparty/generated/hero/skill.xlsx  (ignored)
[2/13] r84598  15%  ✓
```

### Merge Summary (after all revisions)

```
Merge Summary:
  Tree Conflicts (2 + 7 ignored):
    [F]  src/gameplay/module/FooSystem.lua  (working)
    [F]  src/gameplay/module/BarSystem.lua  (working)
    [D]  src/thirdparty/generated/environment/dev  (ignored)
    ...
  Text Conflicts (0 + 2 ignored):
    [F]  src/thirdparty/generated/hero/buff.xlsx  (ignored)
    [F]  src/thirdparty/generated/hero/skill.xlsx  (ignored)
  Ignored (3):
    [F]  src/thirdparty/generated/hero/illustration.xlsx  (ignored)
    ...
```

### Output Files

The log file is written to the `output` directory (default: `.svnmerge/` under workspace).

| File                          | Description                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `svnmerge-yyyymmddhhmmss.log` | Full merge log streamed in real time, with the commit message block appended at the end |

## Conflict Resolution Rules

| Conflict Type                            | Behavior                                       |
| ---------------------------------------- | ---------------------------------------------- |
| Tree conflict                            | `svn resolve --accept working`                 |
| Text conflict                            | `svn resolve --accept theirs-full`             |
| Property conflict                        | `svn resolve --accept theirs-full`             |
| Ignored path (any conflict)              | Override → `working`, displayed in gray        |
| Ignored path (no conflict, but modified) | `svn revert`, displayed in gray as `(ignored)` |

## Tech Stack

- TypeScript 5.5 + ts-node 10.9 (runs directly, no compile step needed)
- [commander](https://github.com/tj/commander.js) — CLI argument parsing
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML config parsing

## Changelog

### 1.1.0-beta
- Refactor: public commands are now `svnmerge run`, `svnmerge cleanup`, and `svnmerge-ui`; `svnmerge` defaults to `run`, and `svnmerge ui` remains a compatible alias
- Refactor: CLI and WebUI now share the same merge pipeline and shared cleanup workflow
- Refactor: merge progress/output is routed through composable loggers instead of direct `stdout` writes in the merge core
- Behavior change: dirty working copies are now blocked before merge; use `svnmerge cleanup` after review if you need to reset the workspace

### 1.0.8
- Fix: property-only modified paths after merge are now kept for post-merge change detection, so workspace-level `svn:mergeinfo` updates are included in auto-commit

### 1.0.7
- Fix: no-`-r` auto-discovered revisions no longer trigger a second confirmation prompt
- Fix: `Tree Conflicts (N + M ignored)` title is now shown in gray when all entries are ignored
- Fix: all ignored paths (both conflicted and reverted) are now consistently displayed as `(ignored)` — not `(reverted)`
- Fix: `Reverted (N Ignored):` section renamed to `Ignored (N):` with `(ignored)` labels
- Fix: auto-commit (`-C`) now only commits files that were actually changed during the merge, excluding ignored/reverted paths

### 1.0.6
- Log preview and `[y/N]` confirm prompt are now shown before merge regardless of whether `-r` is explicitly provided
- "Conflict Summary" renamed to "Merge Summary" in console output and log file
- Merge message is automatically copied to system clipboard after each run
- `copyToClipboard` option in `~/.svnmergerc` (default: `true`) to disable clipboard copy
- `~/.svnmergerc`: new `copyToClipboard` field; auto-created file now includes this option

### 1.0.5
- Auto-commit is now blocked if any conflict occurs on a path **not** in the `ignore` list, regardless of how the conflict was resolved
- In verbose mode (`-V`), Merge Summary is now always printed even when all conflicts are ignored
- `package.json`: added `license`, `repository`, `homepage`, and `bugs` fields

### 1.0.4
- `-d, --dry-run`: preview eligible revisions and their log messages without merging
- `-i, --ignore <paths>`: comma-separated ignore paths, appended to config `ignore` list
- `-C, --commit` / `commit: true`: auto `svn commit` after successful merge using generated message
- `-V, --verbose` (was `-v`), `-v, --version` (was `-V`)
- `-f, --from` replaces `--from-url`; YAML keys renamed: `fromUrl`→`from`, `outputDir`→`output`, `ignoreMerge`→`ignore`
- Config file renamed from `svn-merge-tool.yaml` to `svnmerge.yaml`
- Log file renamed to `svnmerge-yyyymmddhhmmss.log`; commit message appended to log (no separate `message.txt`)
- Resolved parameters (workspace, from, output, ignore, verbose, dry-run, commit, revisions) are printed after config load
- Fix: auto-commit was incorrectly blocked when all conflicts were resolved or ignored; now only truly unresolved conflicts (failed `svn resolve`) block the commit
- Fix: auto-commit skip message now lists the specific revision numbers that failed or have unresolved conflicts

### 1.0.3
- YAML config keys renamed to camelCase: `fromUrl`, `outputDir`, `ignoreMerge`
- `outputDir` config field: customize output directory for log and message files
- `-r` is now optional: omit to merge all eligible revisions (`svn mergeinfo --show-revs eligible`), with confirmation prompt
- Path examples in docs/help text changed to Unix style

### 1.0.2
- `-v / --verbose` flag: ignored and reverted file details are now hidden by default; pass `-v` to show them in the console
- Tree conflicts now display in **red**; text/property conflicts in yellow
- Merge Summary is written to `svn-merge-tool.log` at the end of each run
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
