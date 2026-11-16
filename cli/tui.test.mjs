/**
 * TUI 测试：按键解码、状态归约、帧渲染约束，以及非 TTY 模式下的端到端冒烟。
 * 运行：npm run test:blog-tui
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayWidth } from './format.mjs';
import { createKeyDecoder, decodeChunk } from './tui/keys.mjs';
import { initialState, reduce, visiblePosts } from './tui/state.mjs';
import { render } from './tui/render.mjs';
import { fixtureEnv, makeFixture } from './test-fixture.mjs';

const TUI = join(dirname(fileURLToPath(import.meta.url)), 'tui.mjs');

// ── 测试数据 ──

const POSTS = [
  {
    slug: 'a', title: '甲文章', description: '描述甲', pubDate: '2026-05-01', dayIndex: 1, tags: ['x'],
    draft: false, archived: false, access: 'public', state: 'published', excerpt: '摘要甲', astroId: 'a', updatedAt: '',
  },
  {
    slug: 'b', title: '乙文章', description: '描述乙', pubDate: '2026-04-01', dayIndex: 1, tags: [],
    draft: true, archived: false, access: 'authorized', state: 'draft', excerpt: '摘要乙', astroId: 'b', updatedAt: '',
  },
];

const GALLERY = [
  { id: '独立-1', date: '2026-05-01', title: '图一', src: 'https://cdn.example/1.webp', alt: '', caption: '' },
];

function baseState(over = {}) {
  return initialState({ posts: POSTS, gallery: GALLERY, ...over });
}

// ── 按键解码 ──

describe('按键解码', () => {
  test('方向键与功能键', () => {
    assert.deepEqual(decodeChunk('\u001b[A').keys, ['up']);
    assert.deepEqual(decodeChunk('\u001b[D').keys, ['left']);
    assert.deepEqual(decodeChunk('\u001b[5~').keys, ['pgup']);
    assert.deepEqual(decodeChunk('\u001b[Z').keys, ['shift-tab']);
    assert.deepEqual(decodeChunk('\t').keys, ['tab']);
  });

  test('回车、退格、Ctrl-C 与普通字符', () => {
    assert.deepEqual(decodeChunk('\r').keys, ['enter']);
    assert.deepEqual(decodeChunk('\u007f').keys, ['backspace']);
    assert.deepEqual(decodeChunk('\u0003').keys, ['ctrl-c']);
    assert.deepEqual(decodeChunk('jk/').keys, ['j', 'k', '/']);
  });

  test('跨块的不完整转义序列被缓存后继续解析', () => {
    const decoder = createKeyDecoder();
    assert.deepEqual(decoder.push('\u001b'), []);
    assert.deepEqual(decoder.push('[B'), ['down']);
    assert.deepEqual(decoder.push('j'), ['j']);
  });
});

// ── 状态归约 ──

describe('状态归约', () => {
  test('上下移动并被夹在有效范围内', () => {
    let s = baseState();
    s = reduce(s, 'down').state;
    assert.equal(s.cursor.posts, 1);
    s = reduce(s, 'down').state;
    assert.equal(s.cursor.posts, 1, '不应越界');
    s = reduce(s, 'up').state;
    assert.equal(s.cursor.posts, 0);
    s = reduce(s, 'up').state;
    assert.equal(s.cursor.posts, 0);
  });

  test('g / G 跳到首尾', () => {
    let s = baseState();
    s = reduce(s, 'G').state;
    assert.equal(s.cursor.posts, POSTS.length - 1);
    s = reduce(s, 'g').state;
    assert.equal(s.cursor.posts, 0);
  });

  test('Tab 切换标签页并循环', () => {
    let s = reduce(baseState(), 'tab').state;
    assert.equal(s.tab, 'gallery');
    s = reduce(s, 'tab').state;
    s = reduce(s, 'tab').state;
    assert.equal(s.tab, 'sync');
    s = reduce(s, 'tab').state;
    assert.equal(s.tab, 'posts');
    assert.equal(reduce(baseState(), 'shift-tab').state.tab, 'sync');
  });

  test('帮助开关', () => {
    let s = reduce(baseState(), '?').state;
    assert.equal(s.help, true);
    s = reduce(s, '?').state;
    assert.equal(s.help, false);
  });

  test('状态与权限筛选会重置光标并收窄列表', () => {
    let s = reduce(baseState(), 's').state;
    assert.equal(s.filter.status, 'published');
    assert.deepEqual(visiblePosts(s).map((p) => p.slug), ['a']);
    s = reduce(s, 's').state;
    assert.equal(s.filter.status, 'draft');
    assert.deepEqual(visiblePosts(s).map((p) => p.slug), ['b']);
    assert.equal(reduce(baseState(), 'f').state.filter.access, 'public');
  });

  test('搜索：输入、退格、提交、取消', () => {
    let s = reduce(baseState(), '/').state;
    assert.equal(s.prompt.kind, 'input');
    s = reduce(s, '乙').state;
    s = reduce(s, '文').state;
    assert.equal(s.prompt.value, '乙文');
    s = reduce(s, 'backspace').state;
    assert.equal(s.prompt.value, '乙');
    s = reduce(s, 'enter').state;
    assert.equal(s.prompt, null);
    assert.equal(s.filter.query, '乙');
    assert.deepEqual(visiblePosts(s).map((p) => p.slug), ['b']);

    const cancelled = reduce(reduce(baseState(), '/').state, 'esc').state;
    assert.equal(cancelled.prompt, null);
    assert.equal(cancelled.filter.query, '');
  });

  test('d / A / o 产生对应的修改指令', () => {
    assert.deepEqual(reduce(baseState(), 'd').effects, [{ type: 'update-post', slug: 'a', updates: { draft: true } }]);
    assert.deepEqual(reduce(baseState(), 'A').effects, [{ type: 'update-post', slug: 'a', updates: { archived: true } }]);
    assert.deepEqual(reduce(baseState(), 'o').effects, [{ type: 'update-post', slug: 'a', updates: { access: 'authorized' } }]);
  });

  test('删除需要二次确认，Esc / n 可取消', () => {
    const prompting = reduce(baseState(), 'x').state;
    assert.equal(prompting.prompt.kind, 'confirm');
    assert.deepEqual(reduce(prompting, 'y').effects, [{ type: 'delete-post', slug: 'a' }]);
    assert.deepEqual(reduce(prompting, 'n').effects, []);
    assert.deepEqual(reduce(prompting, 'esc').effects, []);
  });

  test('推送需要确认；拉取直接执行', () => {
    const prompting = reduce(baseState(), 'P').state;
    assert.equal(prompting.prompt.kind, 'confirm');
    assert.deepEqual(reduce(prompting, 'y').effects, [{ type: 'push' }]);
    assert.deepEqual(reduce(baseState(), 'U').effects, [{ type: 'pull' }]);
  });

  test('编辑、新建走对应指令', () => {
    assert.deepEqual(reduce(baseState(), 'enter').effects, [{ type: 'edit-post', slug: 'a' }]);
    const newState = reduce(baseState(), 'n').state;
    assert.equal(newState.prompt.effectType, 'create-post');
  });

  test('处理中忽略按键；q 与 Ctrl-C 退出', () => {
    const busy = { ...baseState(), busy: true };
    assert.equal(reduce(busy, 'j').state.cursor.posts, 0);
    assert.equal(reduce(baseState(), 'q').state.shouldQuit, true);
    assert.deepEqual(reduce(baseState(), 'ctrl-c').effects, [{ type: 'quit' }]);
  });

  test('站点页 Enter 打开数据编辑；访问口令走输入框', () => {
    const site = reduce(baseState(), 'tab').state;
    const siteState = { ...site, tab: 'site' };
    assert.deepEqual(reduce(siteState, 'enter').effects, [{ type: 'edit-data', name: 'about' }]);
    const moved = reduce(reduce(siteState, 'down').state, 'down').state;
    assert.equal(moved.cursor.site, 2);
    assert.equal(reduce(moved, 'enter').state.prompt.mask, true);
  });
});

// ── 渲染 ──

describe('帧渲染', () => {
  const assertFrame = (state) => {
    const lines = render(state);
    assert.equal(lines.length, state.size.rows, '帧行数应等于终端行数');
    for (const l of lines) {
      assert.equal(displayWidth(l.text), state.size.cols, `行宽不符：${JSON.stringify(l.text)}`);
    }
    return lines;
  };

  test('宽终端：帧尺寸严格匹配，含分栏与选中高亮', () => {
    const state = baseState({ size: { rows: 24, cols: 100 } });
    const lines = assertFrame(state);
    const text = lines.map((l) => l.text).join('\n');
    assert.match(text, /ACR·BLOG/);
    assert.match(text, /\[文章\]/, '当前标签应有方括号');
    assert.match(text, /│/, '宽终端应显示分栏');
    const selected = lines.find((l) => l.style === 'reverse');
    assert.ok(selected, '应有选中行');
    assert.match(selected.text, /甲文章/);
  });

  test('窄终端隐藏详情栏，但帧宽仍严格匹配', () => {
    const state = baseState({ size: { rows: 20, cols: 70 } });
    const lines = assertFrame(state);
    assert.ok(!lines.some((l) => l.text.includes('│')), '窄终端不应出现分栏');
  });

  test('超长中文标题按显示宽度截断并补 …', () => {
    const post = { ...POSTS[0], title: '很长的标题'.repeat(12) };
    const state = baseState({ posts: [post], size: { rows: 16, cols: 60 } });
    const lines = assertFrame(state);
    const row = lines.find((l) => l.text.includes('…'));
    assert.ok(row, '应出现截断标记');
  });

  test('帮助覆盖层与提示行', () => {
    const lines = assertFrame(baseState({ size: { rows: 24, cols: 80 }, help: true }));
    assert.match(lines.map((l) => l.text).join('\n'), /快捷键/);
  });

  test('确认框与口令掩码', () => {
    const confirmState = baseState({
      size: { rows: 16, cols: 80 },
      prompt: { kind: 'confirm', label: '推送？', effect: { type: 'push' } },
    });
    assert.match(assertFrame(confirmState).map((l) => l.text).join('\n'), /\(y\/N\)/);

    const secretState = baseState({
      size: { rows: 16, cols: 80 },
      prompt: { kind: 'input', label: '口令：', value: 'abcdef', mask: true, effectType: 'set-password' },
    });
    const text = assertFrame(secretState).map((l) => l.text).join('\n');
    assert.match(text, /\*{6}/);
    assert.doesNotMatch(text, /abcdef/);
  });

  test('画廊页与同步页可渲染', () => {
    const galleryState = baseState({ tab: 'gallery', size: { rows: 16, cols: 80 } });
    const galleryText = assertFrame(galleryState).map((l) => l.text).join('\n');
    assert.match(galleryText, /图一/);
    assert.match(galleryText, /\[画廊\]/);

    const syncState = baseState({
      tab: 'sync',
      size: { rows: 18, cols: 80 },
      sync: { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 0, clean: false, dirtyCount: 1, files: [{ code: '.M', path: 'src/a.md' }] },
    });
    const syncText = assertFrame(syncState).map((l) => l.text).join('\n');
    assert.match(syncText, /main/);
    assert.match(syncText, /领先 2/);
    assert.match(syncText, /src\/a\.md/);
  });
});

// ── 端到端（非 TTY） ──

describe('端到端冒烟', () => {
  let fx;

  before(() => {
    fx = makeFixture();
  });

  after(() => {
    if (fx) rmSync(fx.root, { recursive: true, force: true, maxRetries: 5 });
  });

  const run = (input) => spawnSync(process.execPath, [TUI], {
    cwd: fx.repo,
    encoding: 'utf8',
    input,
    timeout: 120000,
    env: fixtureEnv(fx, { BLOG_TUI_ALLOW_NON_TTY: '1' }),
  });

  test('启动、导航并退出', () => {
    const r = run('jjq');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ACR·BLOG/);
    assert.match(r.stdout, /种子文章/);
  });

  test('按 d 真实切换草稿状态并落盘', () => {
    const file = join(fx.repo, 'src', 'content', 'blog', 'seed.md');
    assert.match(readFileSync(file, 'utf8'), /draft: false/);
    const r = run('d');
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(file, 'utf8'), /draft: true/);
  });
});
