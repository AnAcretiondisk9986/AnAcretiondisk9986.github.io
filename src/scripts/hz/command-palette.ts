/**
 * HORIZON · 全站统一命令面板 (Ctrl/Cmd + K)
 * 按需懒加载 /data/search-index.json，离线/受限环境下内置全站通道兜底，零控制台报错。
 */

interface SearchIndexData {
  channels: Array<{ title: string; desc: string; url: string; kind: string; badge?: string }>;
  categories: Array<{ title: string; desc: string; url: string; kind: string }>;
  posts: Array<{ id: string; title: string; desc: string; url: string; date: string; categories: string[]; tags: string[]; headings: string[] }>;
  projects: Array<{ id: string; title: string; desc: string; url: string; stack: string[]; status: string }>;
  dailies: Array<{ id: string; title: string; date: string; tags: string[]; url: string }>;
  courses: Array<{ id: string; title: string; code: string; dept: string; grade: string; url: string }>;
}

interface SearchHit {
  group: string;
  title: string;
  sub: string;
  url: string;
  badge: string;
  score: number;
}

const FALLBACK_CHANNELS: SearchIndexData['channels'] = [
  { title: '首页 · ORIGIN', desc: '黑洞视界与近期归档', url: '/', kind: 'channel', badge: '01' },
  { title: '文章 · SPECTRUM', desc: '全部文章检索与发射光谱', url: '/blog/', kind: 'channel', badge: '02' },
  { title: '年度 / 阶段观测报告', desc: '自动聚合统计与年度里程碑回顾', url: '/blog/report/', kind: 'channel', badge: '02.1' },
  { title: '日常 · DAILY', desc: '24/7 观测碎片与时间线', url: '/daily/', kind: 'channel', badge: '03' },
  { title: '图像 · LENSING', desc: '摄影与图形档案引力透镜墙', url: '/gallery/', kind: 'channel', badge: '04' },
  { title: '关于 · OBSERVER', desc: '观测者档案、兴趣与词频光谱', url: '/about/', kind: 'channel', badge: '05' },
  { title: '学业 · TRAJECTORY', desc: '双专业转轨课表拼贴与 GPA 遥测', url: '/academics/', kind: 'channel', badge: '06' },
  { title: '日程 · EPHEMERIS', desc: '温医大课程表与时间网格', url: '/schedule/', kind: 'channel', badge: '07' },
  { title: '额度 · FLUX', desc: '多平台 API 算力额度监控', url: '/ai-quota/', kind: 'channel', badge: '08' },
  { title: '造物 / 实验室 · LAB', desc: '开源项目、Agent 系统与站内实验', url: '/projects/', kind: 'channel', badge: '09' },
];

let indexCache: SearchIndexData | null = null;
let indexPromise: Promise<SearchIndexData> | null = null;

async function loadIndex(): Promise<SearchIndexData> {
  if (indexCache) return indexCache;
  if (!indexPromise) {
    indexPromise = fetch('/data/search-index.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        indexCache = data && Array.isArray(data.posts)
          ? data
          : { channels: FALLBACK_CHANNELS, categories: [], posts: [], projects: [], dailies: [], courses: [] };
        return indexCache;
      })
      .catch(() => {
        indexCache = { channels: FALLBACK_CHANNELS, categories: [], posts: [], projects: [], dailies: [], courses: [] };
        return indexCache;
      });
  }
  return indexPromise;
}

function searchIndex(data: SearchIndexData, rawQuery: string): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) {
    return (data.channels || FALLBACK_CHANNELS).map((c, idx) => ({
      group: 'CHANNELS // 快速通道',
      title: c.title,
      sub: c.desc,
      url: c.url,
      badge: c.badge || 'CH',
      score: 100 - idx,
    }));
  }

  const hits: SearchHit[] = [];
  const scoreMatch = (primary: string, secondary = '', base = 50): number => {
    const p = primary.toLowerCase();
    const s = secondary.toLowerCase();
    if (p === q) return base + 60;
    if (p.startsWith(q)) return base + 40;
    if (p.includes(q)) return base + 25;
    if (s.includes(q)) return base;
    return -1;
  };

  for (const c of (data.channels || [])) {
    const sc = scoreMatch(c.title, `${c.desc} ${c.url}`, 55);
    if (sc > 0) hits.push({ group: 'CHANNELS', title: c.title, sub: c.desc, url: c.url, badge: c.badge || 'CH', score: sc });
  }
  for (const c of (data.categories || [])) {
    const sc = scoreMatch(c.title, c.desc, 50);
    if (sc > 0) hits.push({ group: 'CATEGORIES', title: c.title, sub: c.desc, url: c.url, badge: 'CAT', score: sc });
  }
  for (const p of (data.projects || [])) {
    const sc = scoreMatch(p.title, `${p.desc} ${p.stack.join(' ')}`, 60);
    if (sc > 0) hits.push({ group: 'LAB // 造物', title: p.title, sub: p.desc || p.stack.slice(0, 3).join(' · '), url: p.url, badge: 'LAB', score: sc });
  }
  for (const p of (data.posts || [])) {
    const matchedHeading = p.headings.find((h) => h.toLowerCase().includes(q));
    const secondary = `${p.desc} ${p.categories.join(' ')} ${p.tags.join(' ')} ${p.headings.join(' ')}`;
    const sc = scoreMatch(p.title, secondary, 70);
    if (sc > 0) {
      hits.push({
        group: 'SPECTRUM // 文章',
        title: p.title,
        sub: matchedHeading ? `§ ${matchedHeading} · ${p.date}` : `${p.date}${p.categories.length ? ` · ${p.categories.join(' / ')}` : ''}`,
        url: p.url,
        badge: 'POST',
        score: sc,
      });
    }
  }
  for (const d of (data.dailies || [])) {
    const sc = scoreMatch(d.title, d.tags.join(' '), 35);
    if (sc > 0) hits.push({ group: 'DAILY // 日常', title: d.title, sub: d.date, url: d.url, badge: 'TL', score: sc });
  }
  for (const c of (data.courses || [])) {
    const sc = scoreMatch(c.title, `${c.code} ${c.dept} ${c.grade}`, 30);
    if (sc > 0) hits.push({ group: 'TRAJECTORY // 课程', title: c.title, sub: `${c.code} · ${c.dept}${c.grade ? ` · ${c.grade}` : ''}`, url: c.url, badge: 'CR', score: sc });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 24);
}

function initCommandPalette() {
  const dialog = document.getElementById('hz-cmdk') as HTMLDialogElement | null;
  if (!dialog || dialog.dataset.bound === '1') return;
  dialog.dataset.bound = '1';

  const input = dialog.querySelector<HTMLInputElement>('[data-cmdk-input]');
  const list = dialog.querySelector<HTMLElement>('[data-cmdk-list]');
  const status = dialog.querySelector<HTMLElement>('[data-cmdk-status]');
  const closeBtn = dialog.querySelector<HTMLButtonElement>('[data-cmdk-close]');

  let hits: SearchHit[] = [];
  let activeIdx = 0;

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderHits = (items: SearchHit[]) => {
    hits = items;
    activeIdx = items.length ? 0 : -1;
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="hz-cmdk__empty hz-mono">NO MATCHING SIGNALS · 没有匹配结果</div>';
      if (status) status.textContent = '0 MATCHES';
      return;
    }
    if (status) status.textContent = `${items.length} RESULTS · ↑↓ 选择 · ENTER 跳转`;
    list.innerHTML = items.map((it, idx) => `
      <a class="hz-cmdk__item${idx === 0 ? ' is-active' : ''}" href="${esc(it.url)}" data-cmdk-idx="${idx}" role="option" aria-selected="${idx === 0 ? 'true' : 'false'}">
        <span class="hz-cmdk__badge hz-mono">${esc(it.badge)}</span>
        <span class="hz-cmdk__text">
          <strong>${esc(it.title)}</strong>
          <small>${esc(it.sub)}</small>
        </span>
        <span class="hz-cmdk__group hz-mono">${esc(it.group)}</span>
      </a>
    `).join('');
  };

  const setActive = (next: number) => {
    if (!hits.length) return;
    activeIdx = (next + hits.length) % hits.length;
    list?.querySelectorAll<HTMLElement>('[data-cmdk-idx]').forEach((el, idx) => {
      const active = idx === activeIdx;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', String(active));
      if (active) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const refresh = async () => {
    const data = await loadIndex();
    renderHits(searchIndex(data, input?.value || ''));
  };

  const openPalette = async () => {
    if (!dialog.open) dialog.showModal();
    if (input) {
      input.value = '';
      input.focus();
    }
    renderHits(searchIndex(
      indexCache || { channels: FALLBACK_CHANNELS, categories: [], posts: [], projects: [], dailies: [], courses: [] },
      '',
    ));
    await refresh();
  };

  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element | null)?.closest('[data-cmdk-open]');
    if (trigger) {
      e.preventDefault();
      openPalette();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else openPalette();
    }
  });

  closeBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
    const link = (e.target as Element | null)?.closest('a[data-cmdk-idx]');
    if (link) dialog.close();
  });

  input?.addEventListener('input', () => {
    refresh();
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIdx - 1);
    } else if (e.key === 'Enter' && activeIdx >= 0 && hits[activeIdx]) {
      e.preventDefault();
      const targetUrl = hits[activeIdx].url;
      dialog.close();
      location.href = targetUrl;
    }
  });
}

initCommandPalette();
document.addEventListener('astro:page-load', initCommandPalette);
