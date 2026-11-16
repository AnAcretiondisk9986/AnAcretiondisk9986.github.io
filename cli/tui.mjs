#!/usr/bin/env node
/**
 * 博客交互式终端界面（TUI）。
 * 运行：npm run tui  或  node cli/tui.mjs  或  node cli/blog.mjs ui
 *
 * 纯逻辑在 tui/state.mjs（归约）与 tui/render.mjs（渲染），本文件只负责终端与副作用。
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CliError, CONTENT_PUSH_PATHS, blogGit, checkAll, createPost, dataStore, editDataFile, editPost,
  galleryAdd, galleryRemove, getPaths, imageGit, importImage, listPosts, removePost, setPrivatePassword,
  updatePost, warmCdn,
} from './core.mjs';
import { createKeyDecoder } from './tui/keys.mjs';
import { applyData, initialState, notify, reduce, SITE_ENTRIES } from './tui/state.mjs';
import { frameToAnsi, render } from './tui/render.mjs';

const ENTER_SCREEN = '\u001b[?1049h\u001b[?25l\u001b[2J';
const LEAVE_SCREEN = '\u001b[?25h\u001b[?1049l';

function errorText(err) {
  if (err instanceof CliError) return err.message;
  return err?.message ? err.message : String(err);
}

export async function main({ input = process.stdin, output = process.stdout } = {}) {
  const allowNonTty = process.env.BLOG_TUI_ALLOW_NON_TTY === '1';
  const isTty = Boolean(input.isTTY && output.isTTY);
  if (!isTty && !allowNonTty) {
    console.error('交互界面需要在真实终端中运行（当前不是 TTY）。');
    console.error('可改用命令行子命令：node cli/blog.mjs help');
    return 2;
  }

  const paths = getPaths();
  const decoder = createKeyDecoder();
  const queue = [];
  let running = false;
  let screenOn = false;
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const size = () => ({
    cols: Number(output.columns) || 80,
    rows: Number(output.rows) || 24,
  });

  let state = initialState({ size: size() });

  const write = (text) => output.write(text);
  const paint = () => {
    if (!screenOn || finished) return;
    write(frameToAnsi(render(state)));
  };

  function enterScreen() {
    write(ENTER_SCREEN);
    screenOn = true;
    paint();
  }

  function leaveScreen() {
    if (!screenOn) return;
    write(LEAVE_SCREEN);
    screenOn = false;
  }

  // ── 数据加载 ──

  async function loadSiteMeta() {
    const meta = {};
    for (const entry of SITE_ENTRIES) {
      try {
        const st = await stat(join(paths.data, entry.file));
        meta[entry.name] = `${(st.size / 1024).toFixed(1)} KB · 修改于 ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}`;
      } catch {
        meta[entry.name] = '尚未创建';
      }
    }
    return meta;
  }

  async function loadAll() {
    let posts = state.posts;
    let gallery = state.gallery;
    let sync = state.sync;
    const messages = [];
    try {
      posts = await listPosts(paths);
    } catch (err) {
      messages.push(errorText(err));
    }
    try {
      const { data } = await dataStore('gallery', paths).read();
      gallery = Array.isArray(data) ? data : [];
    } catch (err) {
      messages.push(`画廊数据读取失败：${errorText(err)}`);
    }
    try {
      const info = await blogGit(paths).status();
      sync = info;
    } catch (err) {
      sync = null;
      messages.push(`git 状态读取失败：${errorText(err)}`);
    }
    const siteMeta = await loadSiteMeta();
    state = { ...applyData(state, { posts, gallery, sync }), siteMeta };
    if (messages.length) state = notify(state, messages.join('；'), 'error');
  }

  // ── 副作用 ──

  async function withEditor(fn) {
    leaveScreen();
    try {
      return await fn();
    } finally {
      enterScreen();
    }
  }

  async function runEffect(effect) {
    switch (effect.type) {
      case 'quit':
        finish(0);
        return;
      case 'reload':
        await loadAll();
        state = notify(state, '已重新载入', 'ok');
        return;
      case 'edit-post': {
        const result = await withEditor(() => editPost(effect.slug, paths));
        if (result.conflictRevision) {
          state = notify(state, `文章在编辑期间被其他入口修改；你的版本已存为修订 ${result.conflictRevision}`, 'warn');
        } else if (!result.changed) {
          state = notify(state, '内容未变化', 'info');
        } else {
          state = notify(state, `已保存 ${effect.slug}`, 'ok');
        }
        await loadAll();
        return;
      }
      case 'create-post': {
        if (!effect.value) {
          state = notify(state, '标题不能为空', 'error');
          return;
        }
        const created = await createPost({ title: effect.value, p: paths });
        await withEditor(() => editPost(created.slug, paths));
        await loadAll();
        state = notify(state, `已创建 ${created.slug}`, 'ok');
        return;
      }
      case 'update-post': {
        const result = await updatePost(effect.slug, effect.updates, paths);
        await loadAll();
        state = notify(state, result.changed ? `已更新 ${effect.slug}` : '没有实际变化', result.changed ? 'ok' : 'info');
        return;
      }
      case 'delete-post': {
        const id = await removePost(effect.slug, paths);
        await loadAll();
        state = notify(state, `已删除 ${effect.slug}（快照 ${id}，可用 blog history 恢复）`, 'ok');
        return;
      }
      case 'gallery-add': {
        const source = effect.value;
        if (!source) {
          state = notify(state, '路径不能为空', 'error');
          return;
        }
        state = notify(state, `正在导入 ${source}…`, 'info');
        paint();
        let src = source;
        let original = '';
        if (!/^https?:\/\//i.test(source)) {
          const imported = await importImage(source, paths);
          src = imported.url;
          original = imported.originalUrl;
          const pushed = await imageGit(paths).commitAndPush({ paths: ['.'], message: '通过博客 CLI 更新图片' });
          if (pushed.pushed) await warmCdn(src);
        }
        const item = await galleryAdd({ src, title: source.split(/[\\/]/).pop() || source, original, p: paths });
        await loadAll();
        state = notify(state, `已加入画廊：${item.title}`, 'ok');
        return;
      }
      case 'gallery-delete': {
        const removed = await galleryRemove(effect.id, paths);
        await loadAll();
        state = notify(state, `已从画廊移除 ${removed.title}`, 'ok');
        return;
      }
      case 'edit-data': {
        const result = await withEditor(() => editDataFile(effect.name, paths));
        await loadAll();
        state = notify(state, result.changed ? `已保存 ${effect.name}` : '内容未变化', result.changed ? 'ok' : 'info');
        return;
      }
      case 'set-password': {
        if (effect.value.length < 4) {
          state = notify(state, '口令至少 4 个字符', 'error');
          return;
        }
        await setPrivatePassword(effect.value, paths);
        await loadAll();
        state = notify(state, '私密文章口令已更新（仅保存哈希）', 'ok');
        return;
      }
      case 'push': {
        const issues = await checkAll(paths);
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length) {
          state = notify(state, `校验未通过（${errors.length} 个错误），已取消推送：${errors[0].slug} ${errors[0].message}`, 'error');
          return;
        }
        state = notify(state, '正在推送…', 'info');
        paint();
        const git = blogGit(paths);
        const result = await git.commitAndPush({ paths: CONTENT_PUSH_PATHS, message: '通过管理面板更新博客' });
        const img = await imageGit(paths).commitAndPush({ paths: ['.'], message: '通过管理面板更新图片' });
        await loadAll();
        const parts = [result.message];
        if (img.pushed) parts.push('图片仓库已推送');
        state = notify(state, parts.join('；'), result.pushed ? 'ok' : 'info');
        return;
      }
      case 'pull': {
        state = notify(state, '正在拉取…', 'info');
        paint();
        const result = await blogGit(paths).pullFastForward();
        await loadAll();
        state = notify(state, result.message, result.status === 'pulled' ? 'ok' : 'info');
        return;
      }
      default:
        state = notify(state, `未知操作：${effect.type}`, 'error');
    }
  }

  let inputEnded = false;

  async function drain() {
    if (running || finished) return;
    running = true;
    try {
      while (queue.length && !finished) {
        const effect = queue.shift();
        state = { ...state, busy: true };
        paint();
        try {
          await runEffect(effect);
        } catch (err) {
          state = notify(state, errorText(err), 'error');
        }
        state = { ...state, busy: false };
        paint();
      }
    } finally {
      running = false;
      // 非交互模式（测试）：输入结束后把队列跑完再退出
      if (inputEnded && !queue.length && !finished) finish(0);
    }
  }

  // ── 输入 ──

  function handleKeys(keys) {
    for (const key of keys) {
      if (finished) return;
      const result = reduce(state, key);
      state = result.state;
      if (result.effects.length) queue.push(...result.effects);
      paint();
      if (state.shouldQuit) {
        finish(0);
        return;
      }
    }
    void drain();
  }

  let ready = false;
  const earlyKeys = [];

  function onData(chunk) {
    const keys = decoder.push(chunk);
    if (!ready) {
      earlyKeys.push(...keys); // 初次加载完成前的按键先缓存，避免丢键
      return;
    }
    handleKeys(keys);
  }

  function onResize() {
    state = { ...state, size: size() };
    paint();
  }

  function cleanup() {
    if (input.isTTY && typeof input.setRawMode === 'function') {
      try { input.setRawMode(false); } catch { /* 忽略 */ }
    }
    input.removeListener('data', onData);
    output.removeListener('resize', onResize);
    if (typeof input.pause === 'function') input.pause();
  }

  function finish(code) {
    if (finished) return;
    finished = true;
    cleanup();
    leaveScreen();
    resolveDone(code);
  }

  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', onData);
  input.on('end', () => {
    inputEnded = true;
    // 初次加载尚未完成时不要退出，等加载结束后由 drain() 统一收尾
    if (!ready) return;
    if (!running && !queue.length && !finished) finish(0);
  });
  output.on('resize', onResize);
  input.resume();

  enterScreen();
  state = notify(state, '载入中…', 'info');
  paint();
  await loadAll();
  state = notify(state, '', 'info');
  paint();
  ready = true;
  if (earlyKeys.length) handleKeys(earlyKeys.splice(0));
  void drain();

  return done;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => { process.exitCode = typeof code === 'number' ? code : 0; })
    .catch((err) => {
      console.error(`界面启动失败：${errorText(err)}`);
      process.exitCode = 1;
    });
}
