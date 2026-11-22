/**
 * 11 · 学业轨迹可视化编辑（src/data/academics.json）。
 * 支持搜索过滤课程、修改成绩/绩点/状态/笔记/互认说明、新增或删除课程、关联博客文章，以及编辑转专业节点与工具栏。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const ACADEMICS_API = '/api/academics';
const STATUS_LABELS = {
  completed: '已修 / 互认',
  active: '本学期在修',
  planned: '未来修读计划',
};

let acadData = null;
let acadHash = '';
let acadBaseline = '';
let acadDirty = false;
let acadSaving = false;
let acadFilterQ = '';
let acadFilterSem = '';
let selectedView = { type: 'meta', courseId: null }; // 'meta' | 'course'

let ctx = {
  getPosts: () => [],
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
};

export function initAcademics(options = {}) {
  ctx = { ...ctx, ...options };
}

export function isAcademicsDirty() {
  return acadDirty;
}

export function clearAcademicsDirty() {
  acadDirty = false;
  acadBaseline = '';
  ctx.onDirtyChange(false);
}

function syncAcadDirty() {
  if (!acadData) return;
  const next = JSON.stringify(acadData) !== acadBaseline;
  if (next !== acadDirty) {
    acadDirty = next;
    ctx.onDirtyChange(acadDirty);
  }
}

function markAcadBaseline() {
  acadBaseline = acadData ? JSON.stringify(acadData) : '';
  acadDirty = false;
  ctx.onDirtyChange(false);
}

function computePreviewStats() {
  if (!acadData) return { gradedCount: 0, credits: 0, gpa: null };
  let credits = 0;
  let wSum = 0;
  let wCreds = 0;
  let gradedCount = 0;
  for (const c of (acadData.courses || [])) {
    if (c.status === 'completed') credits += Number(c.credits) || 0;
    const g = c.gpa;
    if (typeof g === 'number' && Number.isFinite(g) && (Number(c.credits) || 0) > 0) {
      gradedCount += 1;
      wSum += g * Number(c.credits);
      wCreds += Number(c.credits);
    }
  }
  return { gradedCount, credits: Number(credits.toFixed(1)), gpa: wCreds > 0 ? Number((wSum / wCreds).toFixed(2)) : null };
}

export function renderAcademicsSidebar() {
  const listEl = $('#postList');
  if (!listEl) return;
  if (!acadData) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px">加载学业数据…</div>';
    return;
  }
  const sems = acadData.semesters || [];
  const q = acadFilterQ.trim().toLowerCase();
  const filtered = (acadData.courses || []).filter((c) => {
    if (acadFilterSem && c.semesterId !== acadFilterSem) return false;
    if (q) {
      const hay = `${c.name} ${c.code} ${c.dept} ${c.grade || ''} ${c.note || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const stats = computePreviewStats();

  listEl.innerHTML = `
    <div class="gallery-sidebar-tools">
      <div class="gallery-sidebar-tools__row">
        <button type="button" class="btn small${selectedView.type === 'meta' ? ' primary' : ''}" id="btnAcadMeta">⇄ 转专业节点与全局</button>
        <button type="button" class="btn small primary" id="btnAcadNewCourse">＋ 新增课程</button>
      </div>
      <div class="gallery-sidebar-tools__row">
        <input id="fAcadSearch" type="search" value="${escAttr(acadFilterQ)}" placeholder="搜索课程 / 编号 / 备注…" />
      </div>
      <div class="gallery-sidebar-tools__row">
        <select id="fAcadSem">
          <option value="">全部学期 (${(acadData.courses || []).length})</option>
          ${sems.map((s) => `<option value="${escAttr(s.id)}"${acadFilterSem === s.id ? ' selected' : ''}>${esc(s.label)} (${esc(s.year)})</option>`).join('')}
        </select>
      </div>
      <div class="field-hint">已修 ${stats.credits} 学分 · 录分 ${stats.gradedCount} 门${stats.gpa !== null ? ` · 加权绩点 ${stats.gpa.toFixed(2)}` : ''}</div>
    </div>
    ${filtered.map((c) => `
      <div class="post-card${selectedView.type === 'course' && selectedView.courseId === c.id ? ' active' : ''}" data-acad-course="${escAttr(c.id)}">
        <div class="title">${esc(c.name)} <span style="font-size:10px;color:var(--text-faint)">${esc(c.code)}</span></div>
        <div class="meta">
          ${c.credits} 学分 · ${esc(STATUS_LABELS[c.status] || c.status)}
          ${c.grade ? ` · <strong style="color:var(--accent)">${esc(c.grade)}</strong>` : ''}
          ${typeof c.gpa === 'number' ? ` (${c.gpa.toFixed(2)})` : ''}
          ${(c.posts || []).length ? ` · 📝 ${c.posts.length}` : ''}
        </div>
      </div>`).join('')}`;

  $('#btnAcadMeta')?.addEventListener('click', () => {
    selectedView = { type: 'meta', courseId: null };
    renderAcademicsSidebar();
    renderAcademicsEditor();
  });
  $('#btnAcadNewCourse')?.addEventListener('click', () => {
    const newId = `custom-${Date.now().toString(36)}`;
    const defaultSem = acadFilterSem || acadData.semesters[2]?.id || acadData.semesters[0]?.id || '';
    const semObj = acadData.semesters.find((s) => s.id === defaultSem);
    const course = {
      id: newId,
      code: '',
      name: '新课程',
      credits: 2,
      dept: '',
      nature: '必修课',
      semesterId: defaultSem,
      track: semObj?.track === 'orig' ? 'orig' : 'clin',
      status: 'active',
      grade: '',
      gpa: null,
      note: '',
      posts: [],
      linkedIds: [],
    };
    acadData.courses.push(course);
    selectedView = { type: 'course', courseId: newId };
    syncAcadDirty();
    renderAcademicsSidebar();
    renderAcademicsEditor();
    toast('已新增课程卡片（编辑后按 Ctrl+S 保存）');
  });
  $('#fAcadSearch')?.addEventListener('input', (e) => {
    acadFilterQ = e.target.value;
    renderAcademicsSidebar();
  });
  $('#fAcadSem')?.addEventListener('change', (e) => {
    acadFilterSem = e.target.value;
    renderAcademicsSidebar();
  });
  listEl.querySelectorAll('[data-acad-course]').forEach((card) => {
    card.addEventListener('click', () => {
      selectedView = { type: 'course', courseId: card.dataset.acadCourse };
      renderAcademicsSidebar();
      renderAcademicsEditor();
    });
  });
}

function renderPostCheckboxes(containerId, selectedSlugs = []) {
  const sel = new Set(selectedSlugs);
  const allPosts = (ctx.getPosts() || []).filter((p) => !p.draft).sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
  return `
    <input class="acad-post-filter" data-target="${containerId}" type="search" placeholder="筛选要关联的公开博文…" style="margin-bottom:6px" />
    <div class="rel-post-picker" id="${containerId}">
      ${allPosts.map((p) => `
        <label class="rel-post-option" data-search="${escAttr(`${p.title || ''} ${p.slug}`.toLowerCase())}">
          <input type="checkbox" value="${escAttr(p.slug)}" ${sel.has(p.slug) ? 'checked' : ''} />
          <span class="rpo-title">${esc(p.title || p.slug)}</span>
          <span class="rpo-meta">${esc(p.pubDate || '')}</span>
        </label>`).join('')}
    </div>`;
}

function renderMetaEditor() {
  const meta = acadData.meta || {};
  const tr = acadData.transfer || {};
  const tools = Array.isArray(acadData.tools) ? acadData.tools : [];
  $('#editorTitle').textContent = '学业轨迹 · 转专业节点与全局配置';

  $('#editorContainer').innerHTML = `
    <div class="editor">
      <section class="form-section">
        <div class="form-section-head"><span>页面概览 (meta)</span></div>
        <div class="form-section-body">
          <div class="form-row">
            <div class="form-group"><label>页面标题</label><input id="fAcadTitle" value="${escAttr(meta.title || '')}" /></div>
            <div class="form-group"><label>当前学期标签</label><input id="fAcadTermLabel" value="${escAttr(meta.activeTermLabel || '')}" /></div>
            <div class="form-group" style="max-width:140px"><label>更新日期</label><input id="fAcadUpdated" type="date" value="${escAttr(meta.updatedAt || '')}" /></div>
          </div>
          <div class="form-group"><label>页面副标题</label><textarea id="fAcadSubtitle" rows="2">${esc(meta.subtitle || '')}</textarea></div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>转专业分界线 (ORBITAL TRANSFER) 与复盘文章</span></div>
        <div class="form-section-body">
          <div class="form-row">
            <div class="form-group" style="max-width:120px"><label>时间标识</label><input id="fTrDate" value="${escAttr(tr.date || '')}" /></div>
            <div class="form-group"><label>节点标题</label><input id="fTrTitle" value="${escAttr(tr.title || '')}" /></div>
          </div>
          <div class="form-group"><label>节点说明</label><textarea id="fTrSummary" rows="2">${esc(tr.summary || '')}</textarea></div>
          <div class="form-group">
            <label>关联转专业文章（显示在分界线右侧与遥测区）</label>
            ${renderPostCheckboxes('acadTransferPosts', tr.posts || [])}
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>底部学业工具入口 (${tools.length})</span></div>
        <div class="form-section-body">
          <div id="acadToolsList" style="display:flex;flex-direction:column;gap:8px">
            ${tools.map((t) => `
              <div class="acad-tool-row" style="display:grid;grid-template-columns:1fr 1.6fr 1fr auto;gap:8px;align-items:center">
                <input class="at-label" value="${escAttr(t.label || '')}" placeholder="工具名" />
                <input class="at-href" value="${escAttr(t.href || '')}" placeholder="https:// 或 /" />
                <input class="at-note" value="${escAttr(t.note || '')}" placeholder="副注" />
                <button class="btn small danger" type="button" data-at-del>×</button>
              </div>`).join('')}
          </div>
          <div style="margin-top:8px"><button type="button" class="btn small" id="btnAcadAddTool">＋ 添加工具</button></div>
        </div>
      </section>
    </div>`;

  const applyMetaFromDom = () => {
    acadData.meta = {
      ...acadData.meta,
      title: $('#fAcadTitle')?.value?.trim() || '',
      activeTermLabel: $('#fAcadTermLabel')?.value?.trim() || '',
      updatedAt: $('#fAcadUpdated')?.value?.trim() || '',
      subtitle: $('#fAcadSubtitle')?.value?.trim() || '',
    };
    acadData.transfer = {
      ...acadData.transfer,
      date: $('#fTrDate')?.value?.trim() || '',
      title: $('#fTrTitle')?.value?.trim() || '',
      summary: $('#fTrSummary')?.value?.trim() || '',
      posts: [...document.querySelectorAll('#acadTransferPosts input[type="checkbox"]:checked')].map((i) => i.value),
    };
    acadData.tools = [...document.querySelectorAll('#acadToolsList .acad-tool-row')].map((r) => ({
      label: r.querySelector('.at-label')?.value?.trim() || '',
      href: r.querySelector('.at-href')?.value?.trim() || '',
      note: r.querySelector('.at-note')?.value?.trim() || '',
    })).filter((t) => t.label && t.href);
    syncAcadDirty();
  };

  const edHost = $('#editorContainer > .editor');
  edHost?.addEventListener('input', (e) => {
    if (e.target.classList.contains('acad-post-filter')) {
      const q = e.target.value.trim().toLowerCase();
      const box = $('#' + e.target.dataset.target);
      box?.querySelectorAll('.rel-post-option').forEach((opt) => {
        opt.hidden = Boolean(q && !opt.dataset.search.includes(q));
      });
      return;
    }
    applyMetaFromDom();
  });
  edHost?.addEventListener('change', applyMetaFromDom);
  $('#acadToolsList')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-at-del]')) {
      e.target.closest('.acad-tool-row')?.remove();
      applyMetaFromDom();
    }
  });
  $('#btnAcadAddTool')?.addEventListener('click', () => {
    $('#acadToolsList')?.insertAdjacentHTML('beforeend', `
      <div class="acad-tool-row" style="display:grid;grid-template-columns:1fr 1.6fr 1fr auto;gap:8px;align-items:center">
        <input class="at-label" placeholder="工具名" /><input class="at-href" placeholder="https:// 或 /" /><input class="at-note" placeholder="副注" />
        <button class="btn small danger" type="button" data-at-del>×</button>
      </div>`);
    applyMetaFromDom();
  });
}

function renderCourseEditor(course) {
  $('#editorTitle').textContent = `课程：${course.name} (${course.code || '无编号'})`;
  const sems = acadData.semesters || [];
  $('#editorContainer').innerHTML = `
    <div class="editor">
      <section class="form-section">
        <div class="form-section-head"><span>课程基础与成绩绩点</span></div>
        <div class="form-section-body">
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>课程名称</label><input id="fCName" value="${escAttr(course.name || '')}" /></div>
            <div class="form-group" style="flex:1"><label>课程代码</label><input id="fCCode" value="${escAttr(course.code || '')}" /></div>
            <div class="form-group" style="max-width:90px"><label>学分</label><input id="fCCredits" type="number" step="0.5" value="${Number(course.credits) || 0}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>所属学期</label>
              <select id="fCSem">${sems.map((s) => `<option value="${escAttr(s.id)}"${course.semesterId === s.id ? ' selected' : ''}>${esc(s.label)} (${esc(s.year)})</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>轨线</label>
              <select id="fCTrack"><option value="orig"${course.track === 'orig' ? ' selected' : ''}>orig · 原专业</option><option value="clin"${course.track !== 'orig' ? ' selected' : ''}>clin · 临床医学</option></select>
            </div>
            <div class="form-group"><label>修读状态</label>
              <select id="fCStatus">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}"${course.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>成绩 / 等级 (如：92 / 优秀)</label><input id="fCGrade" value="${escAttr(course.grade || '')}" placeholder="留空表示未出分" /></div>
            <div class="form-group"><label>绩点 (0 ~ 5.0 数值)</label><input id="fCGpa" type="number" step="0.01" min="0" max="5" value="${course.gpa != null ? course.gpa : ''}" placeholder="如 4.6" /></div>
            <div class="form-group"><label>开课单位 (dept)</label><input id="fCDept" value="${escAttr(course.dept || '')}" /></div>
            <div class="form-group"><label>课程性质</label><input id="fCNature" value="${escAttr(course.nature || '')}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>英文名 (可选)</label><input id="fCEn" value="${escAttr(course.en || '')}" /></div>
            <div class="form-group"><label>互认说明 (recognizedNote)</label><input id="fCRecog" value="${escAttr(course.recognizedNote || '')}" /></div>
            <div class="form-group"><label>提前修读注记 (earlyNote)</label><input id="fCEarlyNote" value="${escAttr(course.earlyNote || '')}" /></div>
          </div>
          <div class="form-group"><label>卡片背面笔记 (note)</label><textarea id="fCNote" rows="2" placeholder="翻转卡片背面显示的学习复盘短注…">${esc(course.note || '')}</textarea></div>
          <div class="form-row" style="justify-content:space-between;align-items:center">
            <label class="toggle-row" style="cursor:pointer"><input type="checkbox" id="fCEarly" ${course.early ? 'checked' : ''} /><span>标记为提前修读课程 (early)</span></label>
            <button type="button" class="btn small danger" id="btnDelCourse">删除此课程</button>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>关联博客笔记 (${(course.posts || []).length} 篇已选，将显示在课程翻转背面)</span></div>
        <div class="form-section-body">
          ${renderPostCheckboxes('acadCoursePosts', course.posts || [])}
        </div>
      </section>
    </div>`;

  const applyCourseFromDom = () => {
    const gpaStr = $('#fCGpa')?.value?.trim() || '';
    const gpaNum = gpaStr === '' ? null : Number(gpaStr);
    course.name = $('#fCName')?.value?.trim() || course.name;
    course.code = $('#fCCode')?.value?.trim() || '';
    course.credits = Number($('#fCCredits')?.value || 0);
    course.semesterId = $('#fCSem')?.value || course.semesterId;
    course.track = $('#fCTrack')?.value || 'clin';
    course.status = $('#fCStatus')?.value || 'planned';
    course.grade = $('#fCGrade')?.value?.trim() || '';
    course.gpa = gpaNum !== null && Number.isFinite(gpaNum) ? gpaNum : null;
    course.dept = $('#fCDept')?.value?.trim() || '';
    course.nature = $('#fCNature')?.value?.trim() || '';
    course.en = $('#fCEn')?.value?.trim() || undefined;
    course.recognizedNote = $('#fCRecog')?.value?.trim() || undefined;
    course.earlyNote = $('#fCEarlyNote')?.value?.trim() || undefined;
    course.early = Boolean($('#fCEarly')?.checked);
    course.note = $('#fCNote')?.value?.trim() || '';
    course.posts = [...document.querySelectorAll('#acadCoursePosts input[type="checkbox"]:checked')].map((i) => i.value);
    syncAcadDirty();
  };

  const edHost = $('#editorContainer > .editor');
  edHost?.addEventListener('input', (e) => {
    if (e.target.classList.contains('acad-post-filter')) {
      const q = e.target.value.trim().toLowerCase();
      const box = $('#' + e.target.dataset.target);
      box?.querySelectorAll('.rel-post-option').forEach((opt) => {
        opt.hidden = Boolean(q && !opt.dataset.search.includes(q));
      });
      return;
    }
    applyCourseFromDom();
  });
  edHost?.addEventListener('change', () => {
    applyCourseFromDom();
    renderAcademicsSidebar();
  });
  $('#btnDelCourse')?.addEventListener('click', () => {
    if (!confirm(`确定删除课程「${course.name}」？（按 Ctrl+S 保存生效）`)) return;
    acadData.courses = acadData.courses.filter((x) => x.id !== course.id);
    selectedView = { type: 'meta', courseId: null };
    syncAcadDirty();
    renderAcademicsSidebar();
    renderAcademicsEditor();
  });
}

function renderAcademicsEditor() {
  if (!acadData) return;
  $('#btnDelete').style.display = 'none';
  $('#btnSave').style.display = '';
  $('#btnSave').disabled = false;
  if (selectedView.type === 'course') {
    const course = (acadData.courses || []).find((c) => c.id === selectedView.courseId);
    if (course) { renderCourseEditor(course); return; }
  }
  renderMetaEditor();
}

export async function loadAcademics() {
  try {
    const res = await apiFetch(ACADEMICS_API);
    const data = await res.json();
    if (!res.ok || data.error) { toast(data.error || '加载学业数据失败'); return; }
    const { contentHash: hash, ...rest } = data;
    acadData = rest;
    acadHash = hash || '';
    renderAcademicsSidebar();
    renderAcademicsEditor();
    markAcadBaseline();
  } catch (err) { toast('加载学业数据失败: ' + err.message); }
}

export async function saveAcademics() {
  if (acadSaving || !acadData) return;
  acadSaving = true;
  const saveBtn = $('#btnSave');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 保存中…'; }
  try {
    const res = await apiFetch(ACADEMICS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...acadData, expectedHash: acadHash }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) toast('学业数据已被修改，请点「↻ 刷新」');
      else toast(data.error || '保存失败');
      return;
    }
    acadHash = data.contentHash || acadHash;
    if (data.academics) acadData = data.academics;
    clearAcademicsDirty();
    markAcadBaseline();
    renderAcademicsSidebar();
    toast('学业轨迹已保存（点击顶栏「发布」上线）');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
  } catch (err) { toast('保存学业失败: ' + err.message); }
  finally {
    acadSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存 (Ctrl+S)'; }
  }
}
