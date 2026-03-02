# Agent Memory — svn-merge-tool

## Project Overview

**Name**: `svn-merge-tool`  
**Type**: Node.js CLI tool (published to npm)  
**Purpose**: SVN branch merge tool — merge specific revisions one by one with automatic conflict resolution  
**Language**: TypeScript 5.5 + ts-node 10.9  
**Runtime**: Node.js ≥ 18  
**npm**: https://www.npmjs.com/package/svn-merge-tool  
**GitHub**: https://github.com/alanwalk/svn-merge-tool  
**Current Version**: 1.0.5

---

## Workflow Rules (CRITICAL — never violate)

1. **Auto git commit** after every functional code change: `git add -A && git commit -m "<description>"`
2. **NEVER** run `git push` automatically — user pushes manually
3. **NEVER** modify version numbers (`package.json`, `src/index.ts`) autonomously — user controls versioning
4. **NEVER** create markdown files to document changes unless explicitly requested
5. When editing files, always use `multi_replace_string_in_file` for multiple independent edits in one call

---

## Tech Stack

| Item | Detail |
|------|--------|
| Language | TypeScript 5.5 |
| CLI framework | commander.js ^12.1.0 |
| Config parsing | js-yaml ^4.1.1 |
| Build | `tsc` (outputs to `dist/`) |
| Dev runner | `ts-node src/index.ts` via `npm start` |
| Config file | `svnmerge.yaml` / `svnmerge.yml` (auto-discovered walking up from cwd) |
| Log output | `svnmerge-yyyymmddhhmmss.log` under `<workspace>/.svnmerge/` |

---

## Source File Map

```
src/
  config.ts   — YAML config loading, findDefaultConfig() walk-up discovery
  index.ts    — CLI entry point (commander), parameter resolution, orchestration
  logger.ts   — Timestamped log file writer; appendRaw() for raw text sections
  merger.ts   — Per-revision merge loop, conflict detection, revert logic
  message.ts  — buildMessage() → returns formatted commit message string
  svn.ts      — SVN command wrappers (spawnSync)
  types.ts    — Shared interfaces: ConfigFile, MergeOptions, ConflictInfo, etc.
  utils.ts    — isIgnored(), compressRevisions(), groupSummaryByType(), relPath()
```

---

## CLI Options

```
-v, --version
-c, --config <path>       Path to YAML config file
-w, --workspace <path>    SVN working copy directory
-f, --from <url>          Source branch URL
-r, --revisions <revs>    Revisions/ranges e.g. 1001,1002-1005 (omit = all eligible)
-o, --output <path>       Output directory for log file
-i, --ignore <paths>      Comma-separated paths to ignore (appended to config list)
-V, --verbose             Show ignored/reverted file details
-d, --dry-run             Preview eligible revisions without merging
-C, --commit              Auto svn commit after successful merge
```

## YAML Config Keys

```yaml
workspace: /path/to/working-copy
from: http://svn.example.com/branches/feature
output: /logs/svn            # optional
commit: true                 # optional
verbose: false               # optional
ignore:
  - path/to/ignore
```

---

## Key Design Decisions

### Auto-commit Logic
- Auto-commit triggers only when `--commit` / `commit: true` is set
- **Blocked if**: any conflict occurs on a path **not in the `ignore` list** (regardless of whether `svn resolve` succeeded)
- **Allowed if**: all conflicts are on ignored paths (even if `svn resolve` was called)
- **Judgment basis**: `c.ignored` field on `ConflictInfo`, NOT `c.resolved`
- Skip message includes specific revision numbers that caused the block

### ConflictInfo.ignored vs ConflictInfo.resolved
- `ignored: boolean` — path matches the ignore list → auto-commit still allowed
- `resolved: boolean` — `svnResolve()` call succeeded → does NOT affect auto-commit gate
- The `resolved` field exists for logging purposes only; `ignored` is the sole gate for auto-commit

### Conflict Summary display
- Non-verbose: only shown when `hasActiveConflicts || summary.failed > 0`
- Verbose (`-V`): also shown when any ignored conflicts or reverted files exist

### MergeSummary statistics
- `succeeded`: no conflicts, OR all conflicts are ignored
- `withConflicts`: has at least one non-ignored conflict
- `failed`: `svn merge` command itself returned non-zero with no stdout

### Log file
- Single file: `svnmerge-yyyymmddhhmmss.log`
- Commit message block appended at end via `logger.appendRaw()` with `===` separators
- No separate `message.txt` file

---

## Interface Reference

### ConfigFile (`src/config.ts`)
```typescript
interface ConfigFile {
  workspace?: string;
  from?: string;
  ignore?: string[];
  output?: string;
  verbose?: boolean;
  commit?: boolean;
}
```

### ConflictInfo (`src/types.ts`)
```typescript
interface ConflictInfo {
  path: string;
  type: 'text' | 'tree' | 'property';
  resolution: 'working' | 'theirs-full';
  isDirectory: boolean;
  ignored: boolean;   // path is in ignore list → auto-commit allowed
  resolved: boolean;  // svnResolve() succeeded → logging only
}
```

### MergeSummary (`src/types.ts`)
```typescript
interface MergeSummary {
  total: number;
  succeeded: number;     // clean merge OR all conflicts ignored
  withConflicts: number; // has non-ignored conflicts
  failed: number;        // svn merge command failed
  results: RevisionMergeResult[];
}
```

---

## Release Process

1. Update version in `package.json` and `src/index.ts`
2. Update `README.md` and `README.zh-CN.md` changelog (both files must stay in sync)
3. `npx tsc --noEmit` — verify compilation
4. `git add -A && git commit -m "bump version to X.Y.Z, update README changelog"`
5. `git push origin main`
6. `git tag vX.Y.Z && git push origin vX.Y.Z`
7. `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."` (需先 `gh auth login`)
8. `npm config set registry https://registry.npmjs.org/`
9. `npm publish`
10. `npm config set registry https://registry.npmmirror.com/`

**npm token expires**: re-login with `npm login` if publish returns 401/404.

---

## Published Versions

| Version | npm tag | Key changes |
|---------|---------|-------------|
| 1.0.5 | latest | Auto-commit gated by `ignored` not `resolved`; verbose Conflict Summary; package.json metadata |
| 1.0.4 | — | dry-run, ignore CLI, auto-commit feature, YAML key renames, log consolidation, param print |
| 1.0.3 | — | camelCase config keys, optional -r, outputDir |
| 1.0.2 | — | verbose flag, red tree conflicts, log summary |
| 1.0.1 | — | Fix bin path |
| 1.0.0 | — | Initial release |

---

## Environment Notes

- OS: Windows
- npm registry default: `https://registry.npmmirror.com/` (Taobao mirror)
- Switch to official for publish: `npm config set registry https://registry.npmjs.org/`
- `gh` CLI installed but needs `gh auth login` configuration
- Git remote: `https://github.com/alanwalk/svn-merge-tool.git`
