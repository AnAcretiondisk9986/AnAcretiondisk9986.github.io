/**
 * 受控 Git 命令封装（管理面板发布中心 / CLI / TUI 共用）
 *
 * 设计目标：
 * - 只允许白名单内的 git 子命令，禁止通过字符串拼接执行任意命令（execFile 参数化，不经 shell）。
 * - 统一超时、输出长度上限、非交互环境变量与敏感信息脱敏。
 * - 支持多设备安全协作：
 *   - `pullSmart()`：自动暂存本地未提交改动（含未跟踪文件）→ 快进/变基拉取远端 → 按 id 自动语义合并
 *     daily.json / gallery.json → 还原本地工作区；遇不可自动解决的冲突时原子回滚，绝不覆盖本地文件。
 *   - `commitAndPush()`：默认在推送前/被拒后自动拉取变基并语义合并再推送，消除多端推送死锁。
 *   - 保留 `pullFastForward()` 供严格仅快进场景与既有测试使用。
 */
import { execFile } from 'node:child_process';
import { access, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BLOG_JSON_MERGE_RULES,
  getJsonMergeRule,
  normalizeRepoPath,
  tryMergeKnownJsonFile,
} from './json-merge.mjs';

export const DEFAULT_TIMEOUT = 60_000;
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;

/** 允许执行的 git 子命令集合；其余（如 rm / clean / checkout）一律拒绝 */
export const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'rev-parse', 'rev-list', 'diff', 'add', 'commit',
  'push', 'fetch', 'merge', 'log', 'show', 'symbolic-ref', 'config',
  'stash', 'rebase', 'reset',
]);

/**
 * 脱敏：远端 URL 中的用户名/口令、常见凭据键值、GitHub token 形态。
 * 仅用于返回给前端或写入日志的文本；不影响真实 git 行为。
 */
export function redactSecrets(value) {
  let text = String(value ?? '');
  // https://user:password@host → https://***@host
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@');
  // Authorization 头：整行凭据抹除
  text = text.replace(/(\bauthorization\s*[:=]\s*)(.+)/gi, (_m, prefix) => `${prefix}***`);
  // token=xxx / password: xxx / api_key "xxx"
  text = text.replace(
    /\b(token|password|passwd|secret|api[_-]?key|authorization)(\s*[:=]\s*)("?)([^\s"',;]+)/gi,
    (_m, key, sep, quote) => `${key}${sep}${quote}***`,
  );
  // GitHub PAT 形态
  text = text.replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '***');
  return text;
}

/** 读取 C 风格转义路径（git quotePath 兜底）；普通路径原样返回 */
function unquoteGitPath(raw) {
  const value = String(raw ?? '');
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const body = value.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (/[0-7]/.test(next)) {
      const octal = body.slice(i + 1, i + 4);
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    const escaped = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }[next];
    bytes.push(escaped ?? next.charCodeAt(0));
    i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

export class GitCommandError extends Error {
  constructor(message, { command, code, stdout, stderr, timeout, errorCode, conflicts } = {}) {
    super(message);
    this.name = 'GitCommandError';
    this.command = command;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timeout = Boolean(timeout);
    if (errorCode) this.errorCode = errorCode;
    if (conflicts) this.conflicts = conflicts;
  }
}

function isNonFastForwardText(text) {
  return /non-fast-forward|fetch first|\[rejected\]|rejected|failed to push some refs/i.test(String(text || ''));
}

function classifyGitError(stderr, stdout, timedOut) {
  const text = `${stderr || ''}\n${stdout || ''}`;
  if (timedOut) return 'Git 操作超时，请检查网络或稍后重试';
  if (/could not read from remote|permission denied|host key verification|connection (refused|reset|timed out)|could not resolve host|network is unreachable|unable to access/i.test(text)) {
    return '无法连接远端仓库（网络或鉴权问题），请稍后重试';
  }
  if (isNonFastForwardText(text)) {
    return '推送被拒绝：远端有其它设备推送的更新（分支已分叉），请先拉取合并后再推送';
  }
  if (/not fully merged|would be overwritten|local changes/i.test(text)) {
    return '本地有未提交的更改，操作被 Git 拒绝';
  }
  if (/not a git repository/i.test(text)) return '当前目录不是 Git 仓库';
  if (/no upstream|does not have any commits yet|unknown revision/i.test(text)) return '当前分支还没有可比较的远端版本';
  return 'Git 操作失败，请在发布中心查看详细信息';
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建受控 git 服务实例。
 * @param {object} options
 * @param {string} options.cwd 仓库工作目录
 * @param {string} [options.remote] 远端名，默认 origin
 * @param {number} [options.timeout] 单条命令超时（毫秒）
 * @param {number} [options.maxBuffer] stdout/stderr 上限（字节）
 * @param {Record<string, object>} [options.jsonMergeRules] 按 id 语义合并的 JSON 文件规则
 * @param {(entry: object) => void} [options.onLog] 可选：每次命令执行后的日志回调（已脱敏）
 */
export function createGitService({
  cwd,
  remote = 'origin',
  timeout = DEFAULT_TIMEOUT,
  maxBuffer = DEFAULT_MAX_BUFFER,
  jsonMergeRules = BLOG_JSON_MERGE_RULES,
  onLog,
} = {}) {
  if (!cwd) throw new Error('createGitService 需要 cwd');

  async function run(args, { allowFailure = false, timeoutMs = timeout, maxOutput = maxBuffer } = {}) {
    if (!Array.isArray(args) || !args.length) throw new Error('git 参数不能为空');
    const [subcommand] = args;
    if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
      throw new GitCommandError(`不允许执行的 git 子命令：${subcommand}`, { command: `git ${args.join(' ')}` });
    }
    const startedAt = Date.now();
    const command = `git ${redactSecrets(args.join(' '))}`;
    const result = await new Promise((resolveRun) => {
      execFile('git', ['-c', 'core.quotePath=false', '-c', 'core.editor=true', ...args], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutput,
        windowsHide: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_SEQUENCE_EDITOR: 'true',
        },
      }, (err, stdout, stderr) => {
        resolveRun({
          err,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      });
    });
    const durationMs = Date.now() - startedAt;
    const code = result.err?.code ?? 0;
    const timedOut = Boolean(result.err?.killed) || /timed out/i.test(result.err?.message || '');
    if (onLog) {
      onLog({
        command,
        code: typeof code === 'number' ? code : 1,
        durationMs,
        stdout: redactSecrets(result.stdout).slice(0, MAX_MESSAGE_LENGTH),
        stderr: redactSecrets(result.stderr).slice(0, MAX_MESSAGE_LENGTH),
      });
    }
    if (result.err && !allowFailure) {
      throw new GitCommandError(classifyGitError(result.stderr, result.stdout, timedOut), {
        command,
        code,
        stdout: redactSecrets(result.stdout),
        stderr: redactSecrets(result.stderr),
        timeout: timedOut,
      });
    }
    return {
      ok: !result.err,
      code: typeof code === 'number' ? code : (result.err ? 1 : 0),
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut,
      command,
    };
  }

  /** 解析 `git status --porcelain=v2 --branch` 输出 */
  function parseStatus(stdout) {
    const info = {
      branch: '',
      oid: '',
      upstream: '',
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      files: [],
      unmerged: 0,
    };
    for (const line of String(stdout).split('\n')) {
      if (!line) continue;
      if (line.startsWith('# branch.head ')) {
        info.branch = line.slice('# branch.head '.length).trim();
        continue;
      }
      if (line.startsWith('# branch.oid ')) {
        info.oid = line.slice('# branch.oid '.length).trim();
        continue;
      }
      if (line.startsWith('# branch.upstream ')) {
        info.upstream = line.slice('# branch.upstream '.length).trim();
        info.hasUpstream = true;
        continue;
      }
      if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+)\s+-(\d+)/.exec(line);
        if (m) {
          info.ahead = Number(m[1]);
          info.behind = Number(m[2]);
        }
        continue;
      }
      if (line.startsWith('? ')) {
        info.files.push({ path: unquoteGitPath(line.slice(2)), status: 'untracked', code: '??' });
        continue;
      }
      if (line.startsWith('! ')) continue;
      if (line.startsWith('u ')) {
        const parts = line.slice(2).split(' ');
        info.unmerged += 1;
        info.files.push({ path: unquoteGitPath(parts.slice(9).join(' ')), status: 'conflicted', code: 'UU' });
        continue;
      }
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path> → 7 个字段后是路径
      if (line.startsWith('1 ')) {
        const parts = line.slice(2).split(' ');
        const xy = parts[0] || '..';
        info.files.push({ path: unquoteGitPath(parts.slice(7).join(' ')), status: describeStatusCode(xy), code: xy });
        continue;
      }
      // 2 <XY> ... <X><score> <path>\t<origPath>
      if (line.startsWith('2 ')) {
        const parts = line.slice(2).split(' ');
        const xy = parts[0] || '..';
        const rest = parts.slice(8).join(' ');
        const [pathPart, origPathPart] = rest.split('\t');
        info.files.push({
          path: unquoteGitPath(pathPart),
          from: origPathPart ? unquoteGitPath(origPathPart) : undefined,
          status: 'renamed',
          code: xy,
        });
      }
    }
    return info;
  }

  function describeStatusCode(xy) {
    const [indexStatus, worktreeStatus] = String(xy).padEnd(2, '.').split('');
    const code = indexStatus !== '.' ? indexStatus : worktreeStatus;
    return {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
      T: 'type-changed',
      U: 'conflicted',
    }[code] || 'modified';
  }

  /** 当前分支名 */
  async function currentBranch() {
    const res = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
    return res.stdout.trim() || 'HEAD';
  }

  /** 检查仓库是否处于未完成的 rebase / merge 中间态 */
  async function hasInProgressOperation() {
    const gitDirRes = await run(['rev-parse', '--git-dir'], { allowFailure: true });
    if (!gitDirRes.ok) return false;
    const gitDir = resolve(cwd, gitDirRes.stdout.trim());
    const markers = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'];
    for (const marker of markers) {
      if (await pathExists(join(gitDir, marker))) return true;
    }
    return false;
  }

  /** 列出当前未解决冲突的文件路径 */
  async function listUnmergedFiles() {
    const res = await run(['diff', '--name-only', '--diff-filter=U'], { allowFailure: true });
    if (!res.ok) return [];
    return res.stdout
      .split(/\r?\n/)
      .map((line) => normalizeRepoPath(unquoteGitPath(line.trim())))
      .filter(Boolean);
  }

  /** 列出两个引用之间改动的文件 */
  async function listChangedFiles(rangeExpr) {
    const res = await run(['diff', '--name-only', rangeExpr], { allowFailure: true });
    if (!res.ok) return [];
    return res.stdout
      .split(/\r?\n/)
      .map((line) => normalizeRepoPath(unquoteGitPath(line.trim())))
      .filter(Boolean);
  }

  /** 读取冲突索引的指定阶段内容（1=base, 2=ours/remote, 3=theirs/local） */
  async function readIndexStage(stage, repoPath) {
    const res = await run(['show', `:${stage}:${repoPath}`], { allowFailure: true });
    return res.ok ? res.stdout : null;
  }

  /** 尝试对当前所有冲突文件执行按 id 的三方 JSON 语义合并 */
  async function tryResolveConflictedJsonFiles({ mode }) {
    const unmerged = await listUnmergedFiles();
    if (!unmerged.length) {
      return { ok: false, conflicts: [], autoMerged: [], reason: '' };
    }
    const unsupported = unmerged.filter((p) => !getJsonMergeRule(p, jsonMergeRules));
    if (unsupported.length > 0) {
      return { ok: false, conflicts: unsupported, autoMerged: [], reason: '' };
    }

    // 先在内存中把所有文件全部合并校验完毕，再落盘，避免半途写入
    const planned = [];
    for (const filePath of unmerged) {
      const baseText = await readIndexStage(1, filePath);
      const remoteText = await readIndexStage(2, filePath);
      const localText = await readIndexStage(3, filePath);
      if (remoteText == null || localText == null) {
        return { ok: false, conflicts: [filePath], autoMerged: [], reason: '缺少三方合并所需版本' };
      }
      const merged = tryMergeKnownJsonFile(filePath, {
        baseText,
        localText,
        remoteText,
        rules: jsonMergeRules,
      });
      if (!merged || !merged.ok) {
        return {
          ok: false,
          conflicts: [filePath],
          autoMerged: [],
          reason: merged?.message || '存在同一条目冲突',
        };
      }
      planned.push({ filePath, text: merged.text, stats: merged.stats });
    }

    for (const item of planned) {
      await writeFile(resolve(cwd, item.filePath), item.text, 'utf8');
      if (mode === 'rebase') {
        await run(['add', '--', item.filePath]);
      } else {
        // stash apply 冲突解决后清除索引中的未合并状态，保留为工作区待提交改动
        await run(['reset', '--', item.filePath]);
      }
    }
    return {
      ok: true,
      conflicts: [],
      autoMerged: planned.map((p) => p.filePath),
      details: planned,
      reason: '',
    };
  }

  /** 临时暂存当前工作区改动（包含未跟踪文件），并记录精确 stash oid */
  async function createTempStash(label) {
    const before = (await run(['rev-parse', '--verify', '--quiet', 'refs/stash'], { allowFailure: true })).stdout.trim();
    const pushRes = await run(['stash', 'push', '--include-untracked', '-m', label], { allowFailure: true });
    if (!pushRes.ok) {
      throw new GitCommandError(classifyGitError(pushRes.stderr, pushRes.stdout, pushRes.timedOut), {
        command: pushRes.command,
        code: pushRes.code,
        stdout: redactSecrets(pushRes.stdout),
        stderr: redactSecrets(pushRes.stderr),
        timeout: pushRes.timedOut,
      });
    }
    const after = (await run(['rev-parse', '--verify', '--quiet', 'refs/stash'], { allowFailure: true })).stdout.trim();
    return {
      created: Boolean(after && after !== before),
      oid: after && after !== before ? after : '',
    };
  }

  /** 仅当栈顶 stash 与我们创建的 oid 完全一致时才删除，绝不误删用户自有 stash */
  async function dropStashIfMatching(stashOid) {
    if (!stashOid) return false;
    const top = (await run(['rev-parse', '--verify', '--quiet', 'refs/stash'], { allowFailure: true })).stdout.trim();
    if (top !== stashOid) return false;
    const dropped = await run(['stash', 'drop', 'stash@{0}'], { allowFailure: true });
    return dropped.ok;
  }

  /**
   * 原子回滚到操作前的 origHead 与临时 stash 状态。
   * 注意：当 stash apply 因已跟踪文件冲突失败时，Git 可能已经先从 stash^3 解压出未跟踪文件；
   * 仅在确认 stash^3 仍安全保存该文件后，才移除提前解压出的副本再重新 apply，保证零丢失。
   */
  async function rollbackTo(origHead, stashState, untrackedBefore = []) {
    await run(['rebase', '--abort'], { allowFailure: true });
    if (origHead) {
      await run(['reset', '--hard', origHead], { allowFailure: true });
    }
    if (!stashState?.created) return;

    // 清理上次失败的 stash apply 可能提前释放出来的未跟踪文件副本（确认在 stash^3 中完整备份后再清理）
    for (const relPath of untrackedBefore) {
      const normalized = normalizeRepoPath(relPath);
      const inStash = await run(['rev-parse', '--verify', '--quiet', `${stashState.oid}^3:${normalized}`], { allowFailure: true });
      if (inStash.ok && inStash.stdout.trim()) {
        await unlink(resolve(cwd, normalized)).catch(() => {});
      }
    }
    const restored = await run(['stash', 'apply'], { allowFailure: true });
    if (restored.ok) {
      await dropStashIfMatching(stashState.oid);
    }
  }

  /**
   * 将当前分支变基到 upstream 之上；若重放提交时在已知 JSON 数据文件上冲突，
   * 自动执行按 id 三方语义合并并继续变基；遇真实冲突则自动 `rebase --abort`。
   */
  async function rebaseWithAutoMerge(upstream) {
    const autoMerged = [];
    const first = await run(['rebase', upstream], { allowFailure: true });
    if (first.ok) {
      return { ok: true, autoMerged, conflicts: [], reason: '', detail: redactSecrets(first.stdout) };
    }

    for (let step = 0; step < 50; step += 1) {
      const inProgress = await hasInProgressOperation();
      if (!inProgress) {
        return {
          ok: false,
          autoMerged,
          conflicts: [],
          reason: classifyGitError(first.stderr, first.stdout, first.timedOut),
          detail: redactSecrets(first.stderr || first.stdout),
        };
      }

      const resolved = await tryResolveConflictedJsonFiles({ mode: 'rebase' });
      if (!resolved.ok) {
        const conflicts = resolved.conflicts.length ? resolved.conflicts : await listUnmergedFiles();
        await run(['rebase', '--abort'], { allowFailure: true });
        return {
          ok: false,
          autoMerged,
          conflicts,
          reason: resolved.reason || '',
          detail: redactSecrets(first.stderr || first.stdout),
        };
      }
      autoMerged.push(...resolved.autoMerged);

      // 若合并后当前提交已无实质差异，使用 rebase --skip 避免空提交卡死
      const cachedDiff = await run(['diff', '--cached', '--quiet'], { allowFailure: true });
      const nextStep = cachedDiff.code === 0
        ? await run(['rebase', '--skip'], { allowFailure: true })
        : await run(['rebase', '--continue'], { allowFailure: true });

      if (nextStep.ok) {
        return {
          ok: true,
          autoMerged: [...new Set(autoMerged)],
          conflicts: [],
          reason: '',
          detail: redactSecrets(nextStep.stdout),
        };
      }
    }

    await run(['rebase', '--abort'], { allowFailure: true });
    return {
      ok: false,
      autoMerged,
      conflicts: [],
      reason: '变基步骤过多，已自动回滚',
      detail: '',
    };
  }

  /**
   * 还原临时 stash：
   * - 先检查未跟踪文件是否与远端新加入的同名文件撞车；
   * - 执行 `stash apply`，若仅在可语义合并的 JSON 文件上冲突则自动按 id 三方合并；
   * - 全部还原确认无误后才 drop stash。
   */
  async function restoreStashWithAutoMerge(stashState, { untrackedBefore = [] } = {}) {
    if (!stashState?.created) {
      return { ok: true, autoMerged: [], conflicts: [], reason: '' };
    }

    // 预检：本地未跟踪文件是否与远端拉下来的同名文件撞车
    const untrackedCollisions = [];
    for (const relPath of untrackedBefore) {
      const normalized = normalizeRepoPath(relPath);
      const existsInHead = await run(['rev-parse', '--verify', '--quiet', `HEAD:${normalized}`], { allowFailure: true });
      if (existsInHead.ok && existsInHead.stdout.trim()) {
        untrackedCollisions.push(normalized);
      }
    }
    if (untrackedCollisions.length > 0) {
      return {
        ok: false,
        autoMerged: [],
        conflicts: untrackedCollisions,
        reason: '本地新建文件与远端新增文件重名',
        collisionType: 'untracked-conflict',
      };
    }

    const applied = await run(['stash', 'apply'], { allowFailure: true });
    if (applied.ok) {
      await dropStashIfMatching(stashState.oid);
      return { ok: true, autoMerged: [], conflicts: [], reason: '' };
    }

    const resolved = await tryResolveConflictedJsonFiles({ mode: 'stash-apply' });
    if (resolved.ok) {
      // 防御性校验：确认未跟踪文件均已回到磁盘再丢弃 stash
      let allUntrackedPresent = true;
      for (const relPath of untrackedBefore) {
        if (!(await pathExists(resolve(cwd, normalizeRepoPath(relPath))))) {
          allUntrackedPresent = false;
          break;
        }
      }
      if (allUntrackedPresent) {
        await dropStashIfMatching(stashState.oid);
      }
      return { ok: true, autoMerged: resolved.autoMerged, conflicts: [], reason: '' };
    }

    const conflicts = resolved.conflicts.length ? resolved.conflicts : await listUnmergedFiles();
    return {
      ok: false,
      autoMerged: [],
      conflicts,
      reason: resolved.reason || '',
      collisionType: 'dirty-conflict',
      detail: redactSecrets(applied.stderr || applied.stdout),
    };
  }

  /** 工作区与跟踪分支状态 */
  async function status() {
    const res = await run(['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
    const info = parseStatus(res.stdout);
    if (!info.branch) info.branch = await currentBranch().catch(() => '');
    if (!info.hasUpstream && info.branch && info.branch !== 'HEAD') {
      const upstream = `${remote}/${info.branch}`;
      const check = await run(['rev-parse', '--verify', '--quiet', upstream], { allowFailure: true });
      if (check.ok && check.stdout.trim()) {
        info.upstream = upstream;
        info.hasUpstream = true;
      }
    }
    info.dirtyCount = info.files.length;
    info.clean = info.dirtyCount === 0;
    info.diverged = info.ahead > 0 && info.behind > 0;
    return info;
  }

  /** 预览某次推送会提交哪些文件（不修改索引） */
  async function previewCommit({ paths = ['.'] } = {}) {
    const diffArgs = ['diff', 'HEAD', '--numstat', '--', ...paths];
    const numstat = await run(diffArgs, { allowFailure: true });
    const seen = new Map();
    let insertions = 0;
    let deletions = 0;
    let binary = 0;
    if (numstat.ok) {
      for (const line of numstat.stdout.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const path = unquoteGitPath(parts.slice(2).join('\t'));
        const added = Number(parts[0]);
        const removed = Number(parts[1]);
        if (Number.isFinite(added)) insertions += added;
        else binary += 1;
        if (Number.isFinite(removed)) deletions += removed;
        seen.set(path, { path, status: 'modified', additions: Number.isFinite(added) ? added : 0, deletions: Number.isFinite(removed) ? removed : 0 });
      }
    }
    const untracked = await run(['status', '--porcelain=v2', '--untracked-files=all', '--', ...paths], { allowFailure: true });
    if (untracked.ok) {
      for (const line of untracked.stdout.split('\n')) {
        if (line.startsWith('? ')) {
          const path = unquoteGitPath(line.slice(2));
          if (!seen.has(path)) seen.set(path, { path, status: 'untracked', additions: 0, deletions: 0 });
        } else if (line.startsWith('1 ')) {
          const parts = line.slice(2).split(' ');
          const path = unquoteGitPath(parts.slice(7).join(' '));
          const xy = parts[0] || '..';
          const entry = seen.get(path);
          if (entry) entry.status = describeStatusCode(xy);
          else seen.set(path, { path, status: describeStatusCode(xy), additions: 0, deletions: 0 });
        } else if (line.startsWith('2 ')) {
          const parts = line.slice(2).split(' ');
          const path = unquoteGitPath(parts.slice(8).join(' ').split('\t')[0]);
          if (!seen.has(path)) seen.set(path, { path, status: 'renamed', additions: 0, deletions: 0 });
        }
      }
    }
    const files = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
    return {
      files,
      fileCount: files.length,
      insertions,
      deletions,
      binary,
    };
  }

  /**
   * 暂存 → 提交 →（需要时自动同步变基与语义合并）→ 推送。
   * - `autoSync` 默认开启：当远端有其它设备的新提交时，先保护其它未纳入本次推送的本地改动，
   *   变基重放本地提交（支持 daily.json / gallery.json 按 id 自动合并），还原本地改动后再推送。
   * - 遇真实冲突时自动回滚到已提交的本地状态，不丢失本地提交也不破坏未推送的本地文件。
   */
  async function commitAndPush({ paths = ['.'], message, autoSync = true }) {
    if (!message) throw new Error('缺少提交信息');
    const preview = await previewCommit({ paths });
    const initialStatus = await status();
    let committed = false;

    if (!preview.fileCount) {
      if (!autoSync || initialStatus.ahead === 0) {
        return { committed: false, pushed: false, message: '没有需要推送的更改', preview };
      }
    } else {
      await run(['add', '-A', '--', ...paths]);
      const staged = await run(['diff', '--cached', '--quiet'], { allowFailure: true });
      if (staged.code === 0) {
        if (!autoSync || initialStatus.ahead === 0) {
          return { committed: false, pushed: false, message: '没有需要推送的更改', preview };
        }
      } else {
        await run(['commit', '-m', message]);
        committed = true;
      }
    }

    let syncedBehind = 0;
    let rebased = false;
    const autoMergedFiles = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await status();
      const targetBranch = current.branch && current.branch !== 'HEAD' ? current.branch : 'main';

      // 若已知落后远端，先自动变基整合（保护其它未纳入本次推送的本地文件）
      if (autoSync && current.hasUpstream && current.behind > 0 && current.branch && current.branch !== 'HEAD') {
        const preSyncHead = current.oid || (await run(['rev-parse', 'HEAD'])).stdout.trim();
        const untrackedBefore = current.files.filter((f) => f.status === 'untracked').map((f) => f.path);
        const stashState = !current.clean
          ? await createTempStash(`admin-auto-push-sync-${Date.now()}`)
          : { created: false, oid: '' };

        const rebaseRes = await rebaseWithAutoMerge(current.upstream);
        if (!rebaseRes.ok) {
          await rollbackTo(preSyncHead, stashState, untrackedBefore);
          const conflictText = rebaseRes.conflicts.length
            ? `与远端在 ${rebaseRes.conflicts.join('、')} 存在冲突`
            : (rebaseRes.reason || '与远端分支分叉且无法自动合并');
          const err = new GitCommandError(
            `推送被拒绝（自动同步失败）：${conflictText}，已保留本地提交，请先处理冲突后再推送`,
            {
              command: `git rebase ${current.upstream}`,
              stdout: '',
              stderr: rebaseRes.detail || '',
              errorCode: 'SYNC_CONFLICT',
              conflicts: rebaseRes.conflicts,
            },
          );
          err.status = 409;
          err.preview = preview;
          err.committed = committed;
          throw err;
        }
        autoMergedFiles.push(...rebaseRes.autoMerged);

        const restoreRes = await restoreStashWithAutoMerge(stashState, { untrackedBefore });
        if (!restoreRes.ok) {
          await rollbackTo(preSyncHead, stashState, untrackedBefore);
          const conflictText = restoreRes.conflicts.length
            ? `远端更新与本机未推送的本地改动在 ${restoreRes.conflicts.join('、')} 存在冲突`
            : (restoreRes.reason || '远端更新与本机未推送改动冲突');
          const err = new GitCommandError(
            `推送前自动同步已回滚：${conflictText}，已保留本地提交与未提交改动，请先处理后再推送`,
            {
              command: 'git stash apply',
              stdout: '',
              stderr: restoreRes.detail || '',
              errorCode: 'SYNC_CONFLICT',
              conflicts: restoreRes.conflicts,
            },
          );
          err.status = 409;
          err.preview = preview;
          err.committed = committed;
          throw err;
        }
        autoMergedFiles.push(...restoreRes.autoMerged);
        syncedBehind += current.behind;
        rebased = true;
      }

      const pushArgs = ['push', remote, targetBranch];
      if (!current.hasUpstream) pushArgs.splice(1, 0, '--set-upstream');
      const pushed = await run(pushArgs, { allowFailure: true });
      if (pushed.ok) {
        const mergedUnique = [...new Set(autoMergedFiles)];
        let resultMsg = '推送成功，网站即将更新';
        if (syncedBehind > 0 && mergedUnique.length > 0) {
          resultMsg = `已自动同步远端 ${syncedBehind} 个提交（并自动合并 ${mergedUnique.join('、')}）后推送成功，网站即将更新`;
        } else if (syncedBehind > 0) {
          resultMsg = `已自动同步远端 ${syncedBehind} 个提交并推送成功，网站即将更新`;
        }
        return {
          committed,
          pushed: true,
          syncedRemote: syncedBehind > 0,
          syncedBehind,
          rebased,
          autoMergedFiles: mergedUnique,
          message: resultMsg,
          preview,
          detail: redactSecrets(pushed.stdout).slice(0, MAX_MESSAGE_LENGTH),
        };
      }

      // 若首次推送因为远端有新提交被拒绝，拉取远端引用后重试一轮自动变基 + 推送
      if (autoSync && attempt === 0 && isNonFastForwardText(`${pushed.stderr}\n${pushed.stdout}`)) {
        await fetchRemote();
        continue;
      }

      const error = new GitCommandError(classifyGitError(pushed.stderr, pushed.stdout, pushed.timedOut), {
        command: pushed.command,
        stdout: redactSecrets(pushed.stdout),
        stderr: redactSecrets(pushed.stderr),
        timeout: pushed.timedOut,
      });
      error.preview = preview;
      error.committed = committed;
      throw error;
    }

    throw new GitCommandError('推送失败：远端连续产生新提交，请稍后重试', { command: `git push ${remote}` });
  }

  /** 拉取远端引用（不合并） */
  async function fetchRemote({ timeoutMs = timeout } = {}) {
    return run(['fetch', remote], { timeoutMs });
  }

  /** 远端待拉取提交摘要（附带本地未提交文件的重叠与自动合并分析） */
  async function previewPull() {
    const info = await status();
    if (!info.hasUpstream) {
      return {
        hasUpstream: false,
        branch: info.branch,
        ahead: 0,
        behind: 0,
        commits: [],
        stat: '',
        remoteFiles: [],
        overlappingFiles: [],
        autoMergeableFiles: [],
        riskyOverlapFiles: [],
      };
    }
    const list = await run(['log', '--oneline', '--no-decorate', `HEAD..${info.upstream}`], { allowFailure: true });
    const commits = list.ok
      ? list.stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20)
      : [];
    const stat = await run(['diff', '--stat', `HEAD..${info.upstream}`], { allowFailure: true });
    const remoteFiles = info.behind > 0 ? await listChangedFiles(`HEAD..${info.upstream}`) : [];
    const remoteSet = new Set(remoteFiles);
    const localDirtyPaths = info.files.map((f) => normalizeRepoPath(f.path));
    const overlappingFiles = localDirtyPaths.filter((p) => remoteSet.has(p));
    const autoMergeableFiles = overlappingFiles.filter((p) => Boolean(getJsonMergeRule(p, jsonMergeRules)));
    const riskyOverlapFiles = overlappingFiles.filter((p) => !getJsonMergeRule(p, jsonMergeRules));

    return {
      hasUpstream: true,
      branch: info.branch,
      upstream: info.upstream,
      ahead: info.ahead,
      behind: info.behind,
      commits,
      stat: stat.ok ? redactSecrets(stat.stdout).slice(0, MAX_MESSAGE_LENGTH) : '',
      remoteFiles,
      overlappingFiles,
      autoMergeableFiles,
      riskyOverlapFiles,
    };
  }

  /**
   * 严格安全拉取：仅快进；本地领先 / 分叉 / 工作区脏时跳过并说明原因。
   * 保留供严格仅快进场景与既有单元测试调用。
   */
  async function pullFastForward({ requireClean = true } = {}) {
    await fetchRemote();
    const info = await status();
    const result = { ahead: info.ahead, behind: info.behind, branch: info.branch, upstream: info.upstream };
    if (info.behind === 0 && info.ahead === 0) {
      return { ...result, status: 'up-to-date', message: '本地与远端一致，无需同步' };
    }
    if (info.ahead > 0) {
      return {
        ...result,
        status: 'skipped',
        reason: info.behind > 0 ? 'diverged' : 'local-ahead',
        message: info.behind > 0
          ? `本地与远端已分叉：本地领先 ${info.ahead} 个提交、远端领先 ${info.behind} 个提交，请先处理分叉`
          : `本地领先远端 ${info.ahead} 个提交（有未推送内容），无需拉取`,
      };
    }
    if (requireClean && !info.clean) {
      return {
        ...result,
        status: 'skipped',
        reason: 'dirty',
        message: `远端领先 ${info.behind} 个提交，但本地有 ${info.dirtyCount} 个未提交改动，已跳过拉取以避免覆盖`,
      };
    }
    const merged = await run(['merge', '--ff-only', info.upstream]);
    return {
      ...result,
      status: 'pulled',
      message: `已从远端拉取 ${info.behind} 个提交并完成同步`,
      detail: redactSecrets(merged.stdout).slice(0, MAX_MESSAGE_LENGTH),
    };
  }

  /**
   * 智能安全拉取（多设备协作默认策略）：
   * 1. 若工作区有未提交改动（含未跟踪文件），先自动 stash 保护；
   * 2. 无分叉时快进合并，已分叉时自动 rebase（对 daily.json / gallery.json 自动按 id 三方合并）；
   * 3. 还原本地未提交改动（同样支持对 daily.json / gallery.json 自动三方合并）；
   * 4. 任何步骤遇到无法自动解决的真实冲突时，原子回滚到拉取前原状，返回冲突文件清单。
   */
  async function pullSmart({ fetch = true } = {}) {
    if (await hasInProgressOperation()) {
      const conflicts = await listUnmergedFiles();
      return {
        status: 'conflict',
        reason: 'unmerged',
        conflicts,
        rolledBack: false,
        message: conflicts.length
          ? `工作区存在尚未解决的合并冲突（${conflicts.join('、')}），请先处理后再同步`
          : '工作区存在尚未完成的合并或变基操作，请先处理后再同步',
      };
    }

    if (fetch) await fetchRemote();
    const info = await status();
    const baseResult = {
      ahead: info.ahead,
      behind: info.behind,
      branch: info.branch,
      upstream: info.upstream,
      dirtyCount: info.dirtyCount,
      stashed: false,
      rebased: false,
      autoMergedFiles: [],
      conflicts: [],
    };

    if (info.unmerged > 0) {
      const conflicts = await listUnmergedFiles();
      return {
        ...baseResult,
        status: 'conflict',
        reason: 'unmerged',
        conflicts,
        rolledBack: false,
        message: `工作区存在未解决的冲突文件（${conflicts.join('、')}），请先处理后再同步`,
      };
    }
    if (!info.hasUpstream) {
      return {
        ...baseResult,
        status: 'skipped',
        reason: 'no-upstream',
        message: '当前分支没有远端跟踪分支，无需拉取',
      };
    }
    if (info.behind === 0 && info.ahead === 0) {
      return { ...baseResult, status: 'up-to-date', message: '本地与远端一致，无需同步' };
    }
    if (info.behind === 0 && info.ahead > 0) {
      return {
        ...baseResult,
        status: 'skipped',
        reason: 'local-ahead',
        message: `本地领先远端 ${info.ahead} 个提交（有未推送内容），无需拉取`,
      };
    }
    if (!info.branch || info.branch === 'HEAD') {
      return {
        ...baseResult,
        status: 'skipped',
        reason: 'detached-head',
        message: '当前处于分离头指针状态，请先切回主分支后再同步',
      };
    }

    const origHead = info.oid || (await run(['rev-parse', 'HEAD'])).stdout.trim();
    const untrackedBefore = info.files.filter((f) => f.status === 'untracked').map((f) => f.path);
    const autoMergedFiles = [];
    let stashState = { created: false, oid: '' };

    try {
      // 1. 保护本地未提交改动（含未跟踪文件）
      if (!info.clean) {
        stashState = await createTempStash(`admin-auto-pull-${Date.now()}`);
      }

      // 2. 合并或变基远端提交
      let detail = '';
      let rebased = false;
      if (info.ahead === 0) {
        const merged = await run(['merge', '--ff-only', info.upstream]);
        detail = redactSecrets(merged.stdout).slice(0, MAX_MESSAGE_LENGTH);
      } else {
        const rebaseRes = await rebaseWithAutoMerge(info.upstream);
        if (!rebaseRes.ok) {
          await rollbackTo(origHead, stashState, untrackedBefore);
          const conflicts = rebaseRes.conflicts;
          const fileHint = conflicts.length ? `：${conflicts.join('、')}` : '';
          return {
            ...baseResult,
            status: 'conflict',
            reason: 'rebase-conflict',
            conflicts,
            rolledBack: true,
            message: `远端与本地已提交内容存在冲突${fileHint}，已自动回滚保持原状（未丢失改动）`,
            detail: rebaseRes.reason || rebaseRes.detail || '',
          };
        }
        rebased = true;
        autoMergedFiles.push(...rebaseRes.autoMerged);
        detail = redactSecrets(rebaseRes.detail || '').slice(0, MAX_MESSAGE_LENGTH);
      }

      // 3. 还原本地未提交改动（支持对 daily.json / gallery.json 自动三方合并）
      const restoreRes = await restoreStashWithAutoMerge(stashState, { untrackedBefore });
      if (!restoreRes.ok) {
        await rollbackTo(origHead, stashState, untrackedBefore);
        const conflicts = restoreRes.conflicts;
        const fileHint = conflicts.length ? `：${conflicts.join('、')}` : '';
        return {
          ...baseResult,
          status: 'conflict',
          reason: restoreRes.collisionType || 'dirty-conflict',
          conflicts,
          rolledBack: true,
          message: `远端提交与本地未提交改动修改了同一文件${fileHint}，已自动回滚保持原状（未覆盖你的改动）`,
          detail: restoreRes.reason || restoreRes.detail || '',
        };
      }
      autoMergedFiles.push(...restoreRes.autoMerged);

      const mergedUnique = [...new Set(autoMergedFiles)];
      const parts = [];
      if (rebased) {
        parts.push(`已拉取远端 ${info.behind} 个提交并自动变基整合本地 ${info.ahead} 个提交`);
      } else {
        parts.push(`已从远端拉取 ${info.behind} 个提交`);
      }
      if (stashState.created) {
        parts.push(`完整保留本地 ${info.dirtyCount} 个未提交改动`);
      }
      let message = parts.join('，');
      if (mergedUnique.length > 0) {
        message += `（并自动合并 ${mergedUnique.join('、')}）`;
      } else if (!rebased && !stashState.created) {
        message = `已从远端拉取 ${info.behind} 个提交并完成同步`;
      }

      return {
        ...baseResult,
        status: 'pulled',
        stashed: stashState.created,
        rebased,
        autoMergedFiles: mergedUnique,
        message,
        detail,
      };
    } catch (err) {
      await rollbackTo(origHead, stashState, untrackedBefore).catch(() => {});
      throw err;
    }
  }

  /** 最近提交列表 */
  async function recentCommits(limit = 10) {
    const res = await run(['log', `-${Math.max(1, Math.min(50, limit))}`, '--pretty=format:%h%x09%ad%x09%s', '--date=short'], { allowFailure: true });
    if (!res.ok) return [];
    return res.stdout.split('\n').map((line) => line.split('\t')).filter((parts) => parts.length >= 3).map(([hash, date, subject]) => ({ hash, date, subject }));
  }

  return {
    cwd,
    remote,
    run,
    status,
    previewCommit,
    commitAndPush,
    fetchRemote,
    previewPull,
    pullFastForward,
    pullSmart,
    recentCommits,
  };
}
