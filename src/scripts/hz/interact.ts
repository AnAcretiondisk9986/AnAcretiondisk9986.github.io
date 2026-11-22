/**
 * HORIZON · 跨访客互动客户端（Cloudflare Worker + KV + 本地静默回退）
 * - 解析 <body data-interact-endpoint>：
 *   1) 已配置 URL 时请求 `${endpoint}/daily`、`${endpoint}/daily/:id/like`、`${endpoint}/comments`
 *   2) 未配置时，在本地 dev/admin (localhost/127.0.0.1:4321|4322) 使用同源 `/api/interact`
 *   3) 静态预览或 Worker 离线时静默回退到 localStorage，不阻塞渲染、不抛错
 */

export interface InteractComment {
  id: string;
  target?: string;
  nick: string;
  author?: string;
  body: string;
  createdAt: string;
  local?: boolean;
}

const LOCAL_COMMENT_PREFIX = 'hz-interact-comments-v1:';
const LOCAL_COUNTS_KEY = 'hz-interact-daily-counts-v1';

export function resolveInteractBase(): string | null {
  if (typeof document === 'undefined') return null;
  const raw = (document.body?.dataset.interactEndpoint || '').trim().replace(/\/+$/, '');
  if (raw) {
    return raw.endsWith('/api/interact') ? raw : `${raw}/api/interact`;
  }
  const host = location.hostname;
  const port = location.port;
  if ((host === '127.0.0.1' || host === 'localhost') && (port === '4321' || port === '4322')) {
    return '/api/interact';
  }
  return null;
}

function readLocalComments(target: string): InteractComment[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_COMMENT_PREFIX}${target}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalComments(target: string, items: InteractComment[]) {
  try {
    localStorage.setItem(`${LOCAL_COMMENT_PREFIX}${target}`, JSON.stringify(items.slice(-50)));
  } catch {
    /* ignore */
  }
}

export async function fetchDailyCounts(ids: string[]): Promise<Record<string, number>> {
  const localCounts = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_COUNTS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  })();

  const base = resolveInteractBase();
  if (!base || !ids.length) return localCounts;

  try {
    const res = await fetch(`${base}/daily?ids=${encodeURIComponent(ids.slice(0, 200).join(','))}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return localCounts;
    const data = await res.json();
    if (data?.ok && data.counts && typeof data.counts === 'object') {
      return data.counts as Record<string, number>;
    }
  } catch {
    /* 离线/拦截时静默降级 */
  }
  return localCounts;
}

export async function toggleDailyResonance(id: string, action: 'like' | 'unlike', currentLocalCount = 0): Promise<number> {
  const base = resolveInteractBase();
  if (base) {
    try {
      const res = await fetch(`${base}/daily/${encodeURIComponent(id)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.count === 'number') return data.count;
      }
    } catch {
      /* fallthrough to local */
    }
  }
  const next = action === 'unlike' ? Math.max(0, currentLocalCount - 1) : Math.max(1, currentLocalCount + 1);
  try {
    const map = JSON.parse(localStorage.getItem(LOCAL_COUNTS_KEY) || '{}') || {};
    if (next > 0) map[id] = next;
    else delete map[id];
    localStorage.setItem(LOCAL_COUNTS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  return next;
}

export async function loadTargetComments(target: string): Promise<{ comments: InteractComment[]; remote: boolean }> {
  const local = readLocalComments(target);
  const base = resolveInteractBase();
  if (!base) return { comments: local, remote: false };
  try {
    const res = await fetch(`${base}/comments?target=${encodeURIComponent(target)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { comments: local, remote: false };
    const data = await res.json();
    if (data?.ok && Array.isArray(data.comments)) {
      return { comments: data.comments as InteractComment[], remote: true };
    }
  } catch {
    /* ignore */
  }
  return { comments: local, remote: false };
}

export async function submitTargetComment(payload: {
  target: string;
  author: string;
  body: string;
  website?: string;
}): Promise<{ ok: boolean; comment?: InteractComment; comments?: InteractComment[]; remote: boolean; error?: string }> {
  const target = payload.target.trim();
  const nick = payload.author.trim().slice(0, 30) || '匿名观测者';
  const body = payload.body.trim().slice(0, 300);
  if (!body) return { ok: false, remote: false, error: '评论内容不能为空' };
  if (payload.website && payload.website.trim()) {
    return { ok: true, remote: false, comments: readLocalComments(target) };
  }

  const base = resolveInteractBase();
  if (base) {
    try {
      const res = await fetch(`${base}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ target, nick, body, website: payload.website || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const refreshed = Array.isArray(data.comments)
          ? (data.comments as InteractComment[])
          : (await loadTargetComments(target)).comments;
        return {
          ok: true,
          remote: true,
          comment: data.comment as InteractComment,
          comments: refreshed,
        };
      }
      if (data?.error) return { ok: false, remote: true, error: String(data.error) };
    } catch {
      /* offline -> fallback local */
    }
  }

  const localList = readLocalComments(target);
  const created: InteractComment = {
    id: `local_${Date.now().toString(36)}`,
    target,
    nick,
    body,
    createdAt: new Date().toISOString(),
    local: true,
  };
  const next = [created, ...localList];
  writeLocalComments(target, next);
  return { ok: true, remote: false, comment: created, comments: next };
}

export function renderCommentListInto(container: HTMLElement, comments: InteractComment[], countBadge?: HTMLElement | null) {
  if (countBadge) countBadge.textContent = String(comments.length);
  container.textContent = '';
  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'hz-cmt__empty hz-mono';
    empty.textContent = 'NO SIGNALS YET · 写下第一条回应';
    container.append(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of comments) {
    const row = document.createElement('article');
    row.className = 'hz-cmt__item';

    const head = document.createElement('div');
    head.className = 'hz-cmt__head';

    const who = document.createElement('strong');
    who.textContent = item.nick || item.author || '匿名观测者';

    const time = document.createElement('time');
    time.className = 'hz-mono';
    const ts = Date.parse(item.createdAt);
    time.textContent = Number.isFinite(ts)
      ? new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';

    head.append(who, time);
    if (item.local) {
      const tag = document.createElement('span');
      tag.className = 'hz-mono hz-cmt__local';
      tag.textContent = 'LOCAL';
      head.append(tag);
    }

    const bodyEl = document.createElement('p');
    bodyEl.className = 'hz-cmt__body';
    bodyEl.textContent = item.body;

    row.append(head, bodyEl);
    frag.append(row);
  }
  container.append(frag);
}

export function initInteractPanels() {
  document.querySelectorAll<HTMLElement>('[data-interact-panel]').forEach((panel) => {
    if (panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const target = panel.dataset.target || location.pathname;
    const listEl = panel.querySelector<HTMLElement>('[data-interact-list]');
    const countEl = panel.querySelector<HTMLElement>('[data-interact-count]');
    const modeEl = panel.querySelector<HTMLElement>('[data-interact-mode]');
    const form = panel.querySelector<HTMLFormElement>('[data-interact-form]');
    const authorInput = panel.querySelector<HTMLInputElement>('[data-interact-author]');
    const bodyInput = panel.querySelector<HTMLTextAreaElement>('[data-interact-body]');
    const trapInput = panel.querySelector<HTMLInputElement>('[data-interact-trap]');
    const submitBtn = panel.querySelector<HTMLButtonElement>('[data-interact-submit]');
    const statusEl = panel.querySelector<HTMLElement>('[data-interact-status]');

    if (!listEl) return;

    const refresh = async () => {
      const { comments, remote } = await loadTargetComments(target);
      renderCommentListInto(listEl, comments, countEl);
      if (modeEl) modeEl.textContent = remote ? 'WORKER KV SYNC' : 'LOCAL MODE';
    };

    refresh();

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!bodyInput) return;
      const body = bodyInput.value.trim();
      if (!body) {
        if (statusEl) statusEl.textContent = '请填写留言内容';
        bodyInput.focus();
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = '发送中…';
      try {
        const res = await submitTargetComment({
          target,
          author: authorInput?.value || '',
          body,
          website: trapInput?.value || '',
        });
        if (!res.ok) {
          if (statusEl) statusEl.textContent = res.error || '发送失败';
          return;
        }
        bodyInput.value = '';
        if (res.comments) renderCommentListInto(listEl, res.comments, countEl);
        else await refresh();
        if (modeEl) modeEl.textContent = res.remote ? 'WORKER KV SYNC' : 'LOCAL MODE';
        if (statusEl) statusEl.textContent = res.remote ? '已发送 ✓' : '已本地暂存 ✓';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
}

initInteractPanels();
document.addEventListener('astro:page-load', initInteractPanels);
