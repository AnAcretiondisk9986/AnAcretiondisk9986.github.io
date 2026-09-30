/**
 * 受控 Git 命令封装（管理面板发布中心使用）
 *
 * 设计目标：
 * - 只允许白名单内的 git 子命令，禁止通过字符串拼接执行任意命令（execFile 参数化，不经 shell）。
 * - 统一超时、输出长度上限与敏感信息脱敏。
 * - 把「检查状态 / 预览待提交 / 提交并推送 / 拉取快进」收敛为可测试的方法。
 *
 * 本模块不读取任何配置，不依赖 Express，可在测试中直接用临时仓库构造实例。
 */
import { execFile } from 'node:child_process';

export const DEFAULT_TIMEOUT = 60_000;
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;

/** 允许执行的 git 子命令集合；其余一律拒绝 */
export const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'rev-parse', 'rev-list', 'diff', 'add', 'commit',
  'push', 'fetch', 'merge', 'log', 'show', 'symbolic-ref', 'config',
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
  constructor(message, { command, code, stdout, stderr, timeout } = {}) {
    super(message);
    this.name = 'GitCommandError';
    this.command = command;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timeout = Boolean(timeout);
  }
}

function classifyGitError(stderr, stdout, timedOut) {
  const text = `${stderr || ''}\n${stdout || ''}`;
  if (timedOut) return 'Git 操作超时，请检查网络或稍后重试';
  if (/could not read from remote|permission denied|host key verification|connection (refused|reset|timed out)|could not resolve host|network is unreachable|unable to access/i.test(text)) {
    return '无法连接远端仓库（网络或鉴权问题），请稍后重试';
  }
  if (/non-fast-forward|fetch first|\[rejected\]|rejected|failed to push some refs/i.test(text)) {
    return '推送被拒绝：远端有其它设备推送的更新（分支已分叉），请先拉取合并后再推送';
  }
  if (/not fully merged|would be overwritten|local changes/i.test(text)) {
    return '本地有未提交的更改，操作被 Git 拒绝';
  }
  if (/not a git repository/i.test(text)) return '当前目录不是 Git 仓库';
  if (/no upstream|does not have any commits yet|unknown revision/i.test(text)) return '当前分支还没有可比较的远端版本';
  return 'Git 操作失败，请在发布中心查看详细信息';
}

/**
 * 创建受控 git 服务实例。
 * @param {object} options
 * @param {string} options.cwd 仓库工作目录
 * @param {string} [options.remote] 远端名，默认 origin
 * @param {number} [options.timeout] 单条命令超时（毫秒）
 * @param {number} [options.maxBuffer] stdout/stderr 上限（字节）
 * @param {(entry: object) => void} [options.onLog] 可选：每次命令执行后的日志回调（已脱敏）
 */
export function createGitService({ cwd, remote = 'origin', timeout = DEFAULT_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER, onLog } = {}) {
  if (!cwd) throw new Error('createGitService 需要 cwd');

  async function run(args, { allowFailure = false, timeoutMs = timeout, maxOutput = maxBuffer } = {}) {
    if (!Array.isArray(args) || !args.length) throw new Error('git 参数不能为空');
    const [subcommand] = args;
    if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
      throw new GitCommandError(`不允许执行的 git 子命令：${subcommand}`, { command: `git ${args.join(' ')}` });
    }
    const startedAt = Date.now();
    const command = `git ${redactSecrets(args.join(' '))}`;
    const result = await new Promise((resolve) => {
      execFile('git', ['-c', 'core.quotePath=false', ...args], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutput,
        windowsHide: true,
        encoding: 'utf8',
      }, (err, stdout, stderr) => {
        resolve({
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

  /** 暂存 → 提交 → 推送；返回结构化结果，不抛出网络类错误（由调用方决定如何展示） */
  async function commitAndPush({ paths = ['.'], message }) {
    if (!message) throw new Error('缺少提交信息');
    const preview = await previewCommit({ paths });
    if (!preview.fileCount) {
      return { committed: false, pushed: false, message: '没有需要推送的更改', preview };
    }
    await run(['add', '-A', '--', ...paths]);
    const staged = await run(['diff', '--cached', '--quiet'], { allowFailure: true });
    if (staged.code === 0) {
      return { committed: false, pushed: false, message: '没有需要推送的更改', preview };
    }
    await run(['commit', '-m', message]);
    const afterCommit = await status();
    const targetBranch = afterCommit.branch && afterCommit.branch !== 'HEAD' ? afterCommit.branch : 'main';
    const pushArgs = ['push', remote, targetBranch];
    if (!afterCommit.hasUpstream) pushArgs.splice(1, 0, '--set-upstream');
    const pushed = await run(pushArgs, { allowFailure: true });
    if (!pushed.ok) {
      const error = new GitCommandError(classifyGitError(pushed.stderr, pushed.stdout, pushed.timedOut), {
        command: pushed.command,
        stdout: redactSecrets(pushed.stdout),
        stderr: redactSecrets(pushed.stderr),
        timeout: pushed.timedOut,
      });
      error.preview = preview;
      error.committed = true;
      throw error;
    }
    return {
      committed: true,
      pushed: true,
      message: '推送成功，网站即将更新',
      preview,
      detail: redactSecrets(pushed.stdout).slice(0, MAX_MESSAGE_LENGTH),
    };
  }

  /** 拉取远端引用（不合并） */
  async function fetchRemote({ timeoutMs = timeout } = {}) {
    return run(['fetch', remote], { timeoutMs });
  }

  /** 远端待拉取提交摘要 */
  async function previewPull() {
    const info = await status();
    if (!info.hasUpstream) {
      return { hasUpstream: false, branch: info.branch, ahead: 0, behind: 0, commits: [] };
    }
    const list = await run(['log', '--oneline', '--no-decorate', `HEAD..${info.upstream}`], { allowFailure: true });
    const commits = list.ok
      ? list.stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20)
      : [];
    const stat = await run(['diff', '--stat', `HEAD..${info.upstream}`], { allowFailure: true });
    return {
      hasUpstream: true,
      branch: info.branch,
      upstream: info.upstream,
      ahead: info.ahead,
      behind: info.behind,
      commits,
      stat: stat.ok ? redactSecrets(stat.stdout).slice(0, MAX_MESSAGE_LENGTH) : '',
    };
  }

  /** 安全拉取：仅快进；本地领先 / 分叉 / 工作区脏时跳过并说明原因 */
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
    recentCommits,
  };
}
