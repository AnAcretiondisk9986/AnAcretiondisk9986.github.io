/**
 * HORIZON · academics.ts
 * /academics/ 学业拼贴墙：聚光灯筛选（保持拼贴完整性）、/ 检索、全景海报切换、跨轨互认联动、课程详情抽屉。
 */

interface CoursePayload {
  id: string;
  code: string;
  name: string;
  credits: number;
  kind?: 'course' | 'milestone';
  milestoneLabel?: string;
  dept: string;
  nature: string;
  semesterId: string;
  semesterLabel: string;
  semesterYear: string;
  track: 'orig' | 'clin';
  trackName: string;
  status: 'completed' | 'active' | 'recognized' | 'planned';
  segments?: number;
  early?: boolean;
  earlyNote?: string;
  recognizedNote?: string;
  grade?: string;
  gpa?: number | null;
  note?: string;
  linkedIds?: string[];
  posts: { id: string; title: string; pubDate: string; requiresAuth: boolean }[];
}

const STATUS_LABEL: Record<CoursePayload['status'], string> = {
  completed: '已修读',
  active: '正在修读',
  recognized: '学分互认 · 已修',
  planned: '待修规划',
};

function initAcademics() {
  const root = document.querySelector<HTMLElement>('[data-acad-root]');
  if (!root) return;

  const dataScript = root.querySelector<HTMLScriptElement>('[data-acad-json]');
  let courses: CoursePayload[] = [];
  try {
    courses = dataScript ? (JSON.parse(dataScript.textContent || '[]') as CoursePayload[]) : [];
  } catch {
    courses = [];
  }

  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const tiles = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-tile]')];
  const tileMap = new Map(tiles.map((t) => [t.dataset.id || '', t]));
  const filterBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-filter]')];
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-acad-mode]')];
  const search = root.querySelector<HTMLInputElement>('[data-acad-search]');
  const readout = root.querySelector<HTMLElement>('[data-acad-readout]');

  // Drawer elements
  const backdrop = document.querySelector<HTMLElement>('[data-acad-backdrop]');
  const drawer = document.querySelector<HTMLElement>('[data-acad-drawer]');
  const closeBtn = drawer?.querySelector<HTMLButtonElement>('[data-acad-close]');
  const prevBtn = drawer?.querySelector<HTMLButtonElement>('[data-acad-prev]');
  const nextBtn = drawer?.querySelector<HTMLButtonElement>('[data-acad-next]');
  const dKicker = drawer?.querySelector<HTMLElement>('[data-d-kicker]');
  const dTitle = drawer?.querySelector<HTMLElement>('[data-d-title]');
  const dCode = drawer?.querySelector<HTMLElement>('[data-d-code]');
  const dCredits = drawer?.querySelector<HTMLElement>('[data-d-credits]');
  const dStatus = drawer?.querySelector<HTMLElement>('[data-d-status]');
  const dDept = drawer?.querySelector<HTMLElement>('[data-d-dept]');
  const dNature = drawer?.querySelector<HTMLElement>('[data-d-nature]');
  const dScore = drawer?.querySelector<HTMLElement>('[data-d-score]');
  const dNote = drawer?.querySelector<HTMLElement>('[data-d-note]');
  const dLinksSec = drawer?.querySelector<HTMLElement>('[data-d-links-sec]');
  const dLinks = drawer?.querySelector<HTMLElement>('[data-d-links]');
  const dPostsSec = drawer?.querySelector<HTMLElement>('[data-d-posts-sec]');
  const dPosts = drawer?.querySelector<HTMLElement>('[data-d-posts]');

  let activeFilter = 'all';
  let query = '';
  let selectedId: string | null = null;
  let lastTrigger: HTMLElement | null = null;

  const matchesFilter = (c: CoursePayload): boolean => {
    if (activeFilter === 'lit') return c.status !== 'planned';
    if (activeFilter === 'early') return Boolean(c.early);
    if (activeFilter === 'noted') return Boolean(c.note?.trim()) || c.posts.length > 0;
    if (activeFilter !== 'all') return c.status === activeFilter;
    return true;
  };

  const matchesQuery = (c: CoursePayload): boolean => {
    if (!query) return true;
    const hay = `${c.name} ${c.code} ${c.dept} ${c.semesterLabel} ${c.note || ''}`.toLowerCase();
    return hay.includes(query);
  };

  const applySpotlight = () => {
    let matched = 0;
    for (const tile of tiles) {
      const id = tile.dataset.id || '';
      const c = courseMap.get(id);
      if (!c) continue;
      const ok = matchesFilter(c) && matchesQuery(c);
      tile.classList.toggle('is-dimmed', !ok);
      if (ok) matched += 1;
    }
    if (readout) {
      readout.textContent =
        matched === courses.length && activeFilter === 'all' && !query
          ? `${courses.length} / ${courses.length} BLOCKS`
          : `SPOTLIGHT · ${matched} / ${courses.length} MATCHED`;
    }
  };

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.acadFilter || 'all';
      filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applySpotlight();
    });
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const isPoster = btn.dataset.acadMode === 'poster';
      root.classList.toggle('is-poster', isPoster);
      modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  if (search) {
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      applySpotlight();
    });
  }

  // Cross-track linked course hover highlight
  const clearPeers = () => {
    tiles.forEach((t) => t.classList.remove('is-peer'));
  };
  const highlightPeers = (id: string) => {
    clearPeers();
    const c = courseMap.get(id);
    if (!c?.linkedIds?.length) return;
    for (const pid of c.linkedIds) {
      tileMap.get(pid)?.classList.add('is-peer');
    }
  };

  const renderDrawer = (id: string, focusScroll = false) => {
    const c = courseMap.get(id);
    if (!c || !drawer || !backdrop) return;

    selectedId = id;
    tiles.forEach((t) => t.classList.toggle('is-selected', t.dataset.id === id));

    if (focusScroll) {
      tileMap.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (dKicker) {
      dKicker.textContent = `${c.track === 'orig' ? 'TRACK 01 · 原专业' : 'TRACK 02 · 临床医学'} // ${c.semesterYear} · ${c.semesterLabel}`;
    }
    if (dTitle) dTitle.textContent = c.name;
    if (dCode) dCode.textContent = c.segments && c.segments > 1 ? `${c.code}（课表分段 ×${c.segments}）` : c.code;
    if (dCredits) {
      dCredits.textContent =
        c.kind === 'milestone'
          ? c.milestoneLabel || '临床实践阶段'
          : `${Number.isInteger(c.credits) ? `${c.credits}.0` : c.credits} 学分`;
    }
    if (dDept) dDept.textContent = c.dept;
    if (dNature) dNature.textContent = c.nature;

    if (dStatus) {
      const parts = [STATUS_LABEL[c.status]];
      if (c.earlyNote) parts.push(c.earlyNote);
      if (c.recognizedNote) parts.push(c.recognizedNote);
      dStatus.textContent = parts.join(' · ');
    }

    if (dScore) {
      const hasGrade = Boolean(c.grade && c.grade.trim());
      const hasGpa = typeof c.gpa === 'number';
      if (hasGrade || hasGpa) {
        const chunks: string[] = [];
        if (hasGrade) chunks.push(`成绩 ${c.grade}`);
        if (hasGpa) chunks.push(`绩点 ${c.gpa}`);
        dScore.textContent = chunks.join(' · ');
      } else {
        dScore.textContent = '暂未录入（已预留成绩/绩点字段）';
      }
    }

    if (dNote) {
      const text = c.note?.trim() || '';
      dNote.textContent = text || '暂无课程笔记。可在 src/data/academics.json 的 note 字段中补充学习体会或教材参考。';
      dNote.classList.toggle('hz-drawer__note--empty', !text);
    }

    if (dLinksSec && dLinks) {
      dLinks.replaceChildren();
      const linked = (c.linkedIds || []).map((lid) => courseMap.get(lid)).filter(Boolean) as CoursePayload[];
      dLinksSec.hidden = linked.length === 0;
      for (const peer of linked) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hz-drawer__item';
        const left = document.createElement('span');
        left.textContent = `${peer.name}（${peer.semesterLabel}）`;
        const right = document.createElement('small');
        right.textContent = `${peer.code} · 跳转 →`;
        btn.append(left, right);
        btn.addEventListener('click', () => renderDrawer(peer.id, true));
        dLinks.appendChild(btn);
      }
    }

    if (dPostsSec && dPosts) {
      dPosts.replaceChildren();
      dPostsSec.hidden = c.posts.length === 0;
      for (const post of c.posts) {
        const a = document.createElement('a');
        a.className = 'hz-drawer__item';
        a.href = `/blog/${post.id}/`;
        const left = document.createElement('span');
        left.textContent = post.title;
        const right = document.createElement('small');
        right.textContent = post.requiresAuth ? `${post.pubDate} · 门禁 ↗` : `${post.pubDate} ↗`;
        a.append(left, right);
        dPosts.appendChild(a);
      }
    }

    backdrop.hidden = false;
    drawer.hidden = false;
    closeBtn?.focus();
  };

  const closeDrawer = () => {
    if (!drawer || !backdrop || drawer.hidden) return;
    drawer.hidden = true;
    backdrop.hidden = true;
    selectedId = null;
    tiles.forEach((t) => t.classList.remove('is-selected'));
    lastTrigger?.focus();
  };

  const stepDrawer = (dir: -1 | 1) => {
    if (!selectedId || courses.length === 0) return;
    const idx = courses.findIndex((c) => c.id === selectedId);
    if (idx < 0) return;
    const next = courses[(idx + dir + courses.length) % courses.length];
    renderDrawer(next.id, true);
  };

  tiles.forEach((tile) => {
    const id = tile.dataset.id || '';
    tile.addEventListener('pointerenter', () => highlightPeers(id));
    tile.addEventListener('pointerleave', clearPeers);
    tile.addEventListener('focus', () => highlightPeers(id));
    tile.addEventListener('blur', clearPeers);
    tile.addEventListener('click', () => {
      lastTrigger = tile;
      renderDrawer(id, false);
    });
  });

  closeBtn?.addEventListener('click', closeDrawer);
  backdrop?.addEventListener('click', closeDrawer);
  prevBtn?.addEventListener('click', () => stepDrawer(-1));
  nextBtn?.addEventListener('click', () => stepDrawer(1));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drawer && !drawer.hidden) {
        closeDrawer();
      } else if (search && document.activeElement === search) {
        search.value = '';
        query = '';
        applySpotlight();
        search.blur();
      }
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (drawer && !drawer.hidden) return;
      e.preventDefault();
      search?.focus();
    }
  });

  applySpotlight();
}

initAcademics();
