/**
 * 交互界面的状态与按键归约（纯函数，不碰终端、不碰文件系统）。
 * reduce(state, key) 返回 { state, effects }；effects 是描述性指令，由 cli/tui.mjs 执行。
 */

export const TABS = ['posts', 'gallery', 'site', 'sync'];
export const TAB_LABELS = { posts: '文章', gallery: '画廊', site: '站点', sync: '同步' };
export const ACCESS_ORDER = ['public', 'authorized', 'admin'];
export const STATE_LABELS = {
  published: '已发布',
  draft: '草稿',
  scheduled: '定时',
  archived: '归档',
  private: '私密',
};
/** 's' 键循环的状态筛选：null 表示全部 */
export const STATUS_FILTERS = [null, 'published', 'draft', 'scheduled', 'archived', 'private'];
export const SITE_ENTRIES = [
  { name: 'about', label: '关于页', file: 'about.json' },
  { name: 'frontend', label: '外观', file: 'frontend.json' },
  { name: 'private-access', label: '访问口令', file: 'private-access.json' },
];

export function initialState(over = {}) {
  return {
    tab: 'posts',
    size: { rows: 24, cols: 80 },
    posts: [],
    gallery: [],
    site: SITE_ENTRIES,
    sync: null,
    cursor: { posts: 0, gallery: 0, site: 0, sync: 0 },
    filter: { status: null, access: null, query: '' },
    prompt: null,
    help: false,
    busy: false,
    message: '',
    messageKind: 'info',
    shouldQuit: false,
    ...over,
  };
}

// ── 派生数据 ──

export function visiblePosts(state) {
  const { status, access, query } = state.filter;
  const q = query.trim().toLowerCase();
  return state.posts
    .filter((p) => (!status || p.state === status)
      && (!access || p.access === access)
      && (!q || [p.slug, p.title, p.description, p.excerpt].some((s) => String(s ?? '').toLowerCase().includes(q))))
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate)
      || (b.dayIndex ?? 0) - (a.dayIndex ?? 0)
      || b.slug.localeCompare(a.slug));
}

export function currentPost(state) {
  const list = visiblePosts(state);
  return list[Math.min(state.cursor.posts, list.length - 1)] ?? null;
}

export function currentGallery(state) {
  return state.gallery[Math.min(state.cursor.gallery, state.gallery.length - 1)] ?? null;
}

export function currentSite(state) {
  return state.site[Math.min(state.cursor.site, state.site.length - 1)] ?? null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

function moveCursor(state, tab, delta, total) {
  if (total <= 0) return state;
  const next = clamp((state.cursor[tab] ?? 0) + delta, 0, total - 1);
  if (next === state.cursor[tab]) return state;
  return { ...state, cursor: { ...state.cursor, [tab]: next } };
}

function setMessage(state, message, kind = 'info') {
  return { ...state, message, messageKind: kind };
}

function cycle(list, current) {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

function nextTab(tab, delta = 1) {
  const i = TABS.indexOf(tab);
  return TABS[(i + delta + TABS.length) % TABS.length];
}

// ── 提示框 ──

function openConfirm(state, label, effect) {
  return { ...state, prompt: { kind: 'confirm', label, effect }, message: '' };
}

function openInput(state, label, { value = '', mask = false, effectType, extra = {} } = {}) {
  return { ...state, prompt: { kind: 'input', label, value, mask, effectType, extra }, message: '' };
}

function reducePrompt(state, key) {
  const prompt = state.prompt;
  if (key === 'ctrl-c' || key === 'esc') {
    return { state: { ...state, prompt: null, ...(key === 'esc' || key === 'ctrl-c' ? {} : {}) , message: '已取消' }, effects: [] };
  }
  if (prompt.kind === 'confirm') {
    if (key === 'y' || key === 'Y') {
      return { state: { ...state, prompt: null }, effects: [prompt.effect] };
    }
    if (key === 'n' || key === 'N' || key === 'enter') {
      return { state: { ...state, prompt: null, message: '已取消' }, effects: [] };
    }
    return { state, effects: [] };
  }
  // 文本输入
  if (key === 'enter') {
    const value = prompt.value.trim();
    if (prompt.effectType === 'set-query') {
      return {
        state: {
          ...state,
          prompt: null,
          filter: { ...state.filter, query: value },
          cursor: { ...state.cursor, posts: 0 },
        },
        effects: [],
      };
    }
    return { state: { ...state, prompt: null }, effects: [{ type: prompt.effectType, value, ...prompt.extra }] };
  }
  if (key === 'backspace') {
    return { state: { ...state, prompt: { ...prompt, value: prompt.value.slice(0, -1) } }, effects: [] };
  }
  if (key.length === 1 && key >= ' ') {
    return { state: { ...state, prompt: { ...prompt, value: prompt.value + key } }, effects: [] };
  }
  return { state, effects: [] };
}

// ── 各标签页按键 ──

function reducePosts(state, key) {
  const list = visiblePosts(state);
  switch (key) {
    case 'up':
    case 'k':
      return { state: moveCursor(state, 'posts', -1, list.length), effects: [] };
    case 'down':
    case 'j':
      return { state: moveCursor(state, 'posts', 1, list.length), effects: [] };
    case 'pgup':
      return { state: moveCursor(state, 'posts', -10, list.length), effects: [] };
    case 'pgdown':
      return { state: moveCursor(state, 'posts', 10, list.length), effects: [] };
    case 'home':
    case 'g':
      return { state: { ...state, cursor: { ...state.cursor, posts: 0 } }, effects: [] };
    case 'end':
    case 'G':
      return { state: { ...state, cursor: { ...state.cursor, posts: Math.max(0, list.length - 1) } }, effects: [] };
    case 's': {
      const status = cycle(STATUS_FILTERS, state.filter.status);
      return { state: { ...state, filter: { ...state.filter, status }, cursor: { ...state.cursor, posts: 0 } }, effects: [] };
    }
    case 'f': {
      const access = cycle([null, ...ACCESS_ORDER], state.filter.access);
      return { state: { ...state, filter: { ...state.filter, access }, cursor: { ...state.cursor, posts: 0 } }, effects: [] };
    }
    case '/':
      return {
        state: openInput(state, '搜索标题 / 描述 / slug：', {
          value: state.filter.query,
          effectType: 'set-query',
        }),
        effects: [],
      };
    case 'enter':
    case 'e': {
      const post = currentPost(state);
      if (!post) return { state, effects: [] };
      return { state, effects: [{ type: 'edit-post', slug: post.slug }] };
    }
    case 'n':
      return { state: openInput(state, '新文章标题：', { effectType: 'create-post' }), effects: [] };
    case 'd': {
      const post = currentPost(state);
      if (!post) return { state, effects: [] };
      return { state, effects: [{ type: 'update-post', slug: post.slug, updates: { draft: !post.draft } }] };
    }
    case 'A': {
      const post = currentPost(state);
      if (!post) return { state, effects: [] };
      return { state, effects: [{ type: 'update-post', slug: post.slug, updates: { archived: !post.archived } }] };
    }
    case 'o': {
      const post = currentPost(state);
      if (!post) return { state, effects: [] };
      return { state, effects: [{ type: 'update-post', slug: post.slug, updates: { access: cycle(ACCESS_ORDER, post.access) } }] };
    }
    case 'x': {
      const post = currentPost(state);
      if (!post) return { state, effects: [] };
      return {
        state: openConfirm(state, `删除文章「${post.title}」？（会保留修订快照）`, { type: 'delete-post', slug: post.slug }),
        effects: [],
      };
    }
    default:
      return { state, effects: [] };
  }
}

function reduceGallery(state, key) {
  const total = state.gallery.length;
  switch (key) {
    case 'up':
    case 'k':
      return { state: moveCursor(state, 'gallery', -1, total), effects: [] };
    case 'down':
    case 'j':
      return { state: moveCursor(state, 'gallery', 1, total), effects: [] };
    case 'home':
    case 'g':
      return { state: { ...state, cursor: { ...state.cursor, gallery: 0 } }, effects: [] };
    case 'end':
    case 'G':
      return { state: { ...state, cursor: { ...state.cursor, gallery: Math.max(0, total - 1) } }, effects: [] };
    case 'a':
      return { state: openInput(state, '图片路径或 URL：', { effectType: 'gallery-add' }), effects: [] };
    case 'x': {
      const item = currentGallery(state);
      if (!item) return { state, effects: [] };
      return {
        state: openConfirm(state, `从画廊移除「${item.title}」？（图片文件保留在图片仓库）`, { type: 'gallery-delete', id: item.id }),
        effects: [],
      };
    }
    default:
      return { state, effects: [] };
  }
}

function reduceSite(state, key) {
  const total = state.site.length;
  switch (key) {
    case 'up':
    case 'k':
      return { state: moveCursor(state, 'site', -1, total), effects: [] };
    case 'down':
    case 'j':
      return { state: moveCursor(state, 'site', 1, total), effects: [] };
    case 'enter': {
      const entry = currentSite(state);
      if (!entry) return { state, effects: [] };
      if (entry.name === 'private-access') {
        return { state: openInput(state, '新的私密口令（4-200 字符）：', { mask: true, effectType: 'set-password' }), effects: [] };
      }
      return { state, effects: [{ type: 'edit-data', name: entry.name }] };
    }
    default:
      return { state, effects: [] };
  }
}

// ── 主归约 ──

export function reduce(state, key) {
  if (state.prompt) return reducePrompt(state, key);
  if (state.help) {
    if (key === 'esc' || key === '?' || key === 'q' || key === 'enter') {
      return { state: { ...state, help: false }, effects: [] };
    }
    return { state, effects: [] };
  }
  if (key === 'ctrl-c') return { state: { ...state, shouldQuit: true }, effects: [{ type: 'quit' }] };
  if (key === 'q') return { state: { ...state, shouldQuit: true }, effects: [{ type: 'quit' }] };
  if (state.busy) return { state, effects: [] };

  switch (key) {
    case 'tab':
      return { state: { ...state, tab: nextTab(state.tab, 1) }, effects: [] };
    case 'shift-tab':
      return { state: { ...state, tab: nextTab(state.tab, -1) }, effects: [] };
    case '?':
      return { state: { ...state, help: true }, effects: [] };
    case 'r':
      return { state, effects: [{ type: 'reload' }] };
    case 'P':
      return {
        state: openConfirm(state, '提交并推送改动到远端？', { type: 'push' }),
        effects: [],
      };
    case 'U':
      return { state, effects: [{ type: 'pull' }] };
    default:
      break;
  }

  if (state.tab === 'posts') return reducePosts(state, key);
  if (state.tab === 'gallery') return reduceGallery(state, key);
  if (state.tab === 'site') return reduceSite(state, key);
  if (state.tab === 'sync') {
    switch (key) {
      case 'p':
      case 'P':
        return { state: openConfirm(state, '提交并推送改动到远端？', { type: 'push' }), effects: [] };
      case 'u':
      case 'U':
        return { state, effects: [{ type: 'pull' }] };
      default:
        return { state, effects: [] };
    }
  }
  return { state, effects: [] };
}

/** 应用一次数据加载结果，同时把光标夹回有效范围 */
export function applyData(state, { posts, gallery, sync }) {
  const postsLen = visiblePosts({ ...state, posts }).length;
  const next = {
    ...state,
    posts: posts ?? state.posts,
    gallery: gallery ?? state.gallery,
    sync: sync === undefined ? state.sync : sync,
  };
  return {
    ...next,
    cursor: {
      ...next.cursor,
      posts: clamp(next.cursor.posts, 0, Math.max(0, postsLen - 1)),
      gallery: clamp(next.cursor.gallery, 0, Math.max(0, next.gallery.length - 1)),
    },
  };
}

export function notify(state, message, kind = 'info') {
  return setMessage(state, message, kind);
}
