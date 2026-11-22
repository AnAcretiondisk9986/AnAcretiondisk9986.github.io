/**
 * 09 · 造物 / 实验室管理（src/data/projects.json）。
 * 支持项目增删改、封面图选择/上传、状态与分类、技术栈、多选关联博客文章与标签推导。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const PROJECTS_API = '/api/projects';
const STATUS_LABELS = {
  active: '活跃迭代',
  maintaining: '持续维护',
  experiment: '实验探索',
  archived: '已归档',
};
const KIND_LABELS = {
  web: 'Web / 网站',
  app: '桌面 / 应用',
  cli: 'CLI / 脚本',
  extension: '浏览器扩展',
  ai: 'AI / Agent',
  other: '其他',
};

let projectsList = [];
let projectsHash = '';
let currentProjectId = null;
let projectsFilterQ = '';
let projectsFilterStatus = '';
let projectBaseline = '';
let projectsDirty = false;
let projectEditorActive = false;
let projectSaving = false;

let ctx = {
  getPosts: () => [],
  openMediaPicker: null,
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
};

export function initProjects(options = {}) {
  ctx = { ...ctx, ...options };
}

export function getCurrentProjectId() {
  return currentProjectId;
}

export function isProjectsDirty() {
  return projectsDirty;
}

export function clearProjectsDirty() {
  projectsDirty = false;
  projectBaseline = '';
  projectEditorActive = false;
  ctx.onDirtyChange(false);
}

function readProjectFormPayload() {
  if (!$('#fProjName')) return null;
  const splitComma = (v) => [...new Set(String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
  const splitLines = (v) => [...new Set(String(v || '').split('\n').map((s) => s.trim()).filter(Boolean))];
  const postSlugs = [...document.querySelectorAll('#projPostChoices input[type="checkbox"]:checked')]
    .map((el) => el.value.trim())
    .filter(Boolean);
  return {
    id: $('#fProjId')?.value?.trim() || '',
    name: $('#fProjName')?.value?.trim() || '',
    tagline: $('#fProjTagline')?.value?.trim() || '',
    description: $('#fProjDesc')?.value?.trim() || '',
    status: $('#fProjStatus')?.value || 'maintaining',
    kind: $('#fProjKind')?.value || 'other',
    order: Number($('#fProjOrder')?.value || 1),
    featured: Boolean($('#fProjFeatured')?.checked),
    cover: $('#fProjCover')?.value?.trim() || '',
    repoUrl: $('#fProjRepo')?.value?.trim() || '',
    demoUrl: $('#fProjDemo')?.value?.trim() || '',
    stack: splitComma($('#fProjStack')?.value),
    postTags: splitComma($('#fProjPostTags')?.value),
    highlights: splitLines($('#fProjHighlights')?.value),
    postSlugs,
  };
}

function markProjectBaseline() {
  const payload = readProjectFormPayload();
  projectEditorActive = Boolean(payload);
  projectBaseline = payload ? JSON.stringify(payload) : '';
  projectsDirty = false;
  ctx.onDirtyChange(false);
}

export function syncProjectsDirty() {
  if (!projectEditorActive || !$('#fProjName')) return;
  const payload = readProjectFormPayload();
  const next = JSON.stringify(payload) !== projectBaseline;
  if (next !== projectsDirty) {
    projectsDirty = next;
    ctx.onDirtyChange(projectsDirty);
  }
}

function refreshProjectCoverPreview() {
  const src = $('#fProjCover')?.value?.trim() || '';
  const img = $('#projCoverImg');
  const empty = $('#projCoverEmpty');
  if (!img || !empty) return;
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    empty.hidden = false;
    return;
  }
  img.src = src;
  img.hidden = false;
  empty.hidden = true;
  img.onerror = () => {
    img.hidden = true;
    empty.hidden = false;
    empty.textContent = '图片加载失败';
  };
}

export function renderProjectsSidebar() {
  const listEl = $('#postList');
  if (!listEl) return;
  const q = projectsFilterQ.trim().toLowerCase();
  const filtered = projectsList.filter((p) => {
    if (projectsFilterStatus && p.status !== projectsFilterStatus) return false;
    if (q) {
      const hay = `${p.name} ${p.tagline} ${p.id} ${(p.stack || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rows = filtered.length
    ? filtered.map((p) => `
      <div class="post-card${p.id === currentProjectId ? ' active' : ''}" data-proj-select="${escAttr(p.id)}">
        <div class="title">${p.featured ? '★ ' : ''}${esc(p.name)}</div>
        <div class="meta">
          <span class="badge">${esc(STATUS_LABELS[p.status] || p.status)}</span>
          <span class="badge">${esc(KIND_LABELS[p.kind] || p.kind)}</span>
          ${(p.postSlugs || []).length ? `<span class="badge authorized">${p.postSlugs.length} 篇博文</span>` : ''}
        </div>
        ${p.tagline ? `<div class="post-card-excerpt">${esc(p.tagline)}</div>` : ''}
      </div>`).join('')
    : '<div class="empty-state" style="padding:24px">暂无匹配的造物项目</div>';

  listEl.innerHTML = `
    <div class="gallery-sidebar-tools">
      <div class="gallery-sidebar-tools__row">
        <input id="fProjSearch" type="search" value="${escAttr(projectsFilterQ)}" placeholder="筛选项目 / 技术栈…" />
        <select id="fProjFilterStatus" style="max-width:110px">
          <option value="">全部状态</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}"${projectsFilterStatus === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="field-hint">共 ${projectsList.length} 个项目 · 编辑后按 Ctrl+S 保存</div>
    </div>
    ${rows}`;

  $('#fProjSearch')?.addEventListener('input', (e) => {
    projectsFilterQ = e.target.value;
    renderProjectsSidebar();
  });
  $('#fProjFilterStatus')?.addEventListener('change', (e) => {
    projectsFilterStatus = e.target.value;
    renderProjectsSidebar();
  });
  listEl.querySelectorAll('[data-proj-select]').forEach((card) => {
    card.addEventListener('click', () => {
      if (projectsDirty && !confirm('当前造物项目有未保存修改，确定切换？')) return;
      const item = projectsList.find((x) => x.id === card.dataset.projSelect);
      if (item) renderProjectEditor(item, { isNew: false });
    });
  });
}

function renderProjectEditor(item = {}, { isNew = false } = {}) {
  currentProjectId = isNew ? null : (item.id || null);
  $('#editorTitle').textContent = isNew ? '新建造物项目' : `造物：${item.name || item.id}`;
  $('#btnDelete').style.display = isNew ? 'none' : '';
  $('#btnSave').style.display = '';
  $('#btnSave').disabled = false;

  const selectedSlugs = new Set(item.postSlugs || []);
  const allPosts = (ctx.getPosts() || []).slice().sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));

  $('#editorContainer').innerHTML = `
    <div class="editor">
      <section class="form-section">
        <div class="form-section-head"><span>项目标识与状态</span></div>
        <div class="form-section-body">
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>项目名称</label><input id="fProjName" value="${escAttr(item.name || '')}" placeholder="如：HORIZON 架构重写 / ClinMedAgent-RAG" /></div>
            <div class="form-group" style="flex:1"><label>项目 ID (Slug)</label><input id="fProjId" value="${escAttr(item.id || '')}" placeholder="留空自动生成" ${isNew ? '' : 'readonly style="opacity:.75"'} /></div>
          </div>
          <div class="form-group"><label>一句话标语 (Tagline)</label><input id="fProjTagline" value="${escAttr(item.tagline || '')}" placeholder="在卡片顶部展示的一句简介" /></div>
          <div class="form-row">
            <div class="form-group"><label>状态</label>
              <select id="fProjStatus">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}"${(item.status || 'maintaining') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>形态分类</label>
              <select id="fProjKind">${Object.entries(KIND_LABELS).map(([k, v]) => `<option value="${k}"${(item.kind || 'other') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="form-group" style="max-width:96px"><label>排序</label><input id="fProjOrder" type="number" value="${Number(item.order) || (projectsList.length + 1)}" /></div>
            <div class="form-group" style="justify-content:flex-end">
              <label class="toggle-row" style="cursor:pointer;margin-top:18px">
                <input type="checkbox" id="fProjFeatured" ${item.featured ? 'checked' : ''} />
                <span>置顶精选 (Featured)</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>封面、链接与技术栈</span></div>
        <div class="form-section-body">
          <div class="post-cover-editor">
            <div class="post-cover-preview" id="projCoverBox" style="cursor:pointer" title="点击从媒体库选择封面">
              <img id="projCoverImg" alt="" hidden />
              <span class="post-cover-empty" id="projCoverEmpty">暂无封面</span>
            </div>
            <div class="post-cover-fields">
              <div class="form-group">
                <label>封面图片地址</label>
                <input id="fProjCover" value="${escAttr(item.cover || '')}" placeholder="/images/... 或图片直链 URL" />
              </div>
              <div class="post-cover-actions">
                <button type="button" class="btn small" id="btnProjCoverPicker">媒体库选图</button>
                <button type="button" class="btn small" id="btnProjCoverUpload">⬆ 上传本地图片</button>
                <button type="button" class="btn small" id="btnProjCoverClear">清除</button>
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>代码仓库 / 主页链接 (repoUrl)</label><input id="fProjRepo" value="${escAttr(item.repoUrl || '')}" placeholder="https://github.com/..." /></div>
            <div class="form-group"><label>在线演示 / 站内链接 (demoUrl)</label><input id="fProjDemo" value="${escAttr(item.demoUrl || '')}" placeholder="https://... 或 /schedule/" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>技术栈（逗号分隔）</label><input id="fProjStack" value="${escAttr((item.stack || []).join(', '))}" placeholder="Astro 7, WebGL, TypeScript, Cloudflare Worker" /></div>
            <div class="form-group"><label>按标签自动匹配博文（逗号分隔）</label><input id="fProjPostTags" value="${escAttr((item.postTags || []).join(', '))}" placeholder="与标签重合的公开博文也会关联展示" /></div>
          </div>
          <div class="form-group"><label>详细说明</label><textarea id="fProjDesc" rows="3" placeholder="介绍造物的来龙去脉与解决的问题…">${esc(item.description || '')}</textarea></div>
          <div class="form-group"><label>核心特性（每行一条，最多 8 条）</label><textarea id="fProjHighlights" rows="3" placeholder="每行一条特性亮点…">${esc((item.highlights || []).join('\n'))}</textarea></div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>手动关联文章 (${selectedSlugs.size} 篇已选)</span></div>
        <div class="form-section-body">
          <input id="fProjPostSearch" type="search" placeholder="筛选文章标题 / Slug…" style="margin-bottom:8px" />
          <div class="rel-post-picker" id="projPostChoices">
            ${allPosts.map((p) => `
              <label class="rel-post-option" data-search="${escAttr(`${p.title || ''} ${p.slug}`.toLowerCase())}">
                <input type="checkbox" value="${escAttr(p.slug)}" ${selectedSlugs.has(p.slug) ? 'checked' : ''} />
                <span class="rpo-title">${esc(p.title || p.slug)}</span>
                <span class="rpo-meta">${esc(p.pubDate || '')} · ${esc(p.slug)}</span>
              </label>`).join('')}
          </div>
        </div>
      </section>
    </div>`;

  refreshProjectCoverPreview();
  renderProjectsSidebar();
  markProjectBaseline();

  $('#editorContainer').querySelectorAll('input, textarea, select').forEach((el) => {
    if (el.id === 'fProjPostSearch') return;
    el.addEventListener('input', () => {
      if (el.id === 'fProjCover') refreshProjectCoverPreview();
      syncProjectsDirty();
    });
    el.addEventListener('change', () => {
      if (el.id === 'fProjCover') refreshProjectCoverPreview();
      syncProjectsDirty();
    });
  });

  $('#fProjPostSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#projPostChoices .rel-post-option').forEach((opt) => {
      opt.hidden = Boolean(q && !opt.dataset.search.includes(q));
    });
  });

  const pickMedia = () => {
    ctx.openMediaPicker?.({
      type: 'image',
      title: '选择造物项目封面',
      onPick: (m) => {
        const inp = $('#fProjCover');
        if (inp) inp.value = m.url;
        refreshProjectCoverPreview();
        syncProjectsDirty();
      },
    });
  };
  $('#btnProjCoverPicker')?.addEventListener('click', pickMedia);
  $('#projCoverBox')?.addEventListener('click', pickMedia);
  $('#btnProjCoverUpload')?.addEventListener('click', () => $('#fileInput')?.click());
  $('#btnProjCoverClear')?.addEventListener('click', () => {
    const inp = $('#fProjCover');
    if (inp) inp.value = '';
    refreshProjectCoverPreview();
    syncProjectsDirty();
  });
}

export function newProjectItem({ skipLeaveGuard = false } = {}) {
  if (!skipLeaveGuard && projectsDirty && !confirm('当前造物项目有未保存修改，确定新建？')) return;
  renderProjectEditor({}, { isNew: true });
}

export async function loadProjects() {
  try {
    const res = await apiFetch(PROJECTS_API);
    const data = await res.json();
    if (!res.ok || data.error) { toast(data.error || '加载造物项目失败'); return; }
    projectsList = Array.isArray(data.projects) ? data.projects : [];
    projectsHash = data.contentHash || '';
    const active = projectsList.find((p) => p.id === currentProjectId) || projectsList[0];
    if (active) renderProjectEditor(active, { isNew: false });
    else renderProjectEditor({}, { isNew: true });
  } catch (err) { toast('加载造物项目失败: ' + err.message); }
}

export async function saveProjectItem() {
  if (projectSaving) return;
  const payload = readProjectFormPayload();
  if (!payload) return;
  if (!payload.name) { toast('请填写项目名称'); return; }
  projectSaving = true;
  const saveBtn = $('#btnSave');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 保存中…'; }
  try {
    const isEdit = Boolean(currentProjectId);
    const url = isEdit ? `${PROJECTS_API}/${encodeURIComponent(currentProjectId)}` : PROJECTS_API;
    const method = isEdit ? 'PUT' : 'POST';
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, expectedHash: projectsHash }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) toast('造物数据版本冲突，请点「↻ 刷新」');
      else toast(data.error || '保存失败');
      return;
    }
    projectsList = data.projects || projectsList;
    projectsHash = data.contentHash || projectsHash;
    currentProjectId = data.item?.id || currentProjectId;
    clearProjectsDirty();
    if (data.item) renderProjectEditor(data.item, { isNew: false });
    toast('造物项目已保存（点击顶栏「发布」上线）');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
  } catch (err) { toast('保存造物失败: ' + err.message); }
  finally {
    projectSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存 (Ctrl+S)'; }
  }
}

export async function deleteProjectItem(id = currentProjectId) {
  if (!id) return;
  const item = projectsList.find((p) => p.id === id);
  if (!confirm(`确定删除造物项目「${item?.name || id}」？`)) return;
  try {
    const res = await apiFetch(`${PROJECTS_API}/${encodeURIComponent(id)}?expectedHash=${encodeURIComponent(projectsHash)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || data.error) { toast(data.error || '删除失败'); return; }
    projectsList = data.projects || [];
    projectsHash = data.contentHash || projectsHash;
    currentProjectId = null;
    clearProjectsDirty();
    const next = projectsList[0];
    if (next) renderProjectEditor(next, { isNew: false });
    else renderProjectEditor({}, { isNew: true });
    toast('已删除造物项目');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
  } catch (err) { toast('删除失败: ' + err.message); }
}
