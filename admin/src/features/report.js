/**
 * 10 · 年度 / 阶段观测报告管理（src/data/report.json）。
 * 支持报告增删改、日期区间统计实时预览、里程碑可视化增删排序、精选博文与日常多选。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const REPORTS_API = '/api/reports';

let reportDoc = { activeReportId: '', reports: [] };
let reportHash = '';
let currentReportId = null;
let dailyItemsCache = [];
let reportBaseline = '';
let reportDirty = false;
let reportEditorActive = false;
let reportSaving = false;

let ctx = {
  getPosts: () => [],
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
};

export function initReport(options = {}) {
  ctx = { ...ctx, ...options };
}

export function getCurrentReportId() {
  return currentReportId;
}

export function isReportDirty() {
  return reportDirty;
}

export function clearReportDirty() {
  reportDirty = false;
  reportBaseline = '';
  reportEditorActive = false;
  ctx.onDirtyChange(false);
}

function milestoneRowHtml(m = {}) {
  return `
    <div class="milestone-edit-row" style="display:grid;grid-template-columns:110px 1fr 1.3fr 140px auto;gap:6px;align-items:center">
      <input class="ms-date" value="${escAttr(m.date || '')}" placeholder="2026-11" />
      <input class="ms-title" value="${escAttr(m.title || '')}" placeholder="里程碑标题" />
      <input class="ms-detail" value="${escAttr(m.detail || '')}" placeholder="说明" />
      <input class="ms-link" value="${escAttr(m.link || '')}" placeholder="/blog/... 或 https://" />
      <button class="btn small danger" type="button" data-ms-del>×</button>
    </div>`;
}

function readReportFormPayload() {
  if (!$('#fRepTitle')) return null;
  const keywords = [...new Set(String($('#fRepKeywords')?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
  const milestones = [...document.querySelectorAll('#repMilestonesList .milestone-edit-row')].map((row) => ({
    date: row.querySelector('.ms-date')?.value?.trim() || '',
    title: row.querySelector('.ms-title')?.value?.trim() || '',
    detail: row.querySelector('.ms-detail')?.value?.trim() || '',
    link: row.querySelector('.ms-link')?.value?.trim() || '',
  })).filter((m) => m.title);
  const featuredPosts = [...document.querySelectorAll('#repFeaturedPosts input[type="checkbox"]:checked')].map((i) => i.value);
  const featuredDailies = [...document.querySelectorAll('#repFeaturedDailies input[type="checkbox"]:checked')].map((i) => i.value);
  return {
    id: $('#fRepId')?.value?.trim() || '',
    title: $('#fRepTitle')?.value?.trim() || '',
    subtitle: $('#fRepSubtitle')?.value?.trim() || '',
    periodLabel: $('#fRepPeriodLabel')?.value?.trim() || '',
    dateStart: $('#fRepStart')?.value || '',
    dateEnd: $('#fRepEnd')?.value || '',
    summary: $('#fRepSummary')?.value?.trim() || '',
    outroQuote: $('#fRepOutro')?.value?.trim() || '',
    keywords,
    milestones,
    featuredPosts,
    featuredDailies,
    order: Number($('#fRepOrder')?.value || 1),
    published: $('#fRepPublished')?.checked !== false,
    setActive: Boolean($('#fRepSetActive')?.checked),
  };
}

function markReportBaseline() {
  const payload = readReportFormPayload();
  reportEditorActive = Boolean(payload);
  reportBaseline = payload ? JSON.stringify(payload) : '';
  reportDirty = false;
  ctx.onDirtyChange(false);
}

function syncReportDirty() {
  if (!reportEditorActive || !$('#fRepTitle')) return;
  const payload = readReportFormPayload();
  const next = JSON.stringify(payload) !== reportBaseline;
  if (next !== reportDirty) {
    reportDirty = next;
    ctx.onDirtyChange(reportDirty);
  }
}

function refreshPeriodPreviewStats() {
  const box = $('#repPreviewStats');
  if (!box) return;
  const start = $('#fRepStart')?.value || '';
  const end = $('#fRepEnd')?.value || '';
  const posts = (ctx.getPosts() || []).filter((p) => {
    if (p.draft || p.archived || p.access === 'admin') return false;
    const d = p.pubDate || '';
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
  const dailies = dailyItemsCache.filter((d) => {
    const dt = d.date || '';
    if (start && dt < start) return false;
    if (end && dt > end) return false;
    return true;
  });
  box.textContent = `区间实时命中：公开博文 ${posts.length} 篇 · 日常碎片 ${dailies.length} 条（构建时将自动汇总字数、分类光谱与热力图）`;
}

export function renderReportSidebar() {
  const listEl = $('#postList');
  if (!listEl) return;
  const rows = (reportDoc.reports || []).length
    ? reportDoc.reports.map((r) => `
      <div class="post-card${r.id === currentReportId ? ' active' : ''}" data-rep-select="${escAttr(r.id)}">
        <div class="title">
          ${esc(r.title)}
          ${r.id === reportDoc.activeReportId ? '<span class="badge authorized">默认主报</span>' : ''}
          ${r.published === false ? '<span class="badge draft">隐藏</span>' : ''}
        </div>
        <div class="meta">${esc(r.periodLabel || `${r.dateStart || '起点'} ~ ${r.dateEnd || '至今'}`)} · ${(r.milestones || []).length} 里程碑</div>
      </div>`).join('')
    : '<div class="empty-state" style="padding:20px">暂无观测报告，请点击上方「＋ 新建」</div>';

  listEl.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-faint);line-height:1.8">
      <div style="color:var(--accent);margin-bottom:4px">10 · 年度 / 阶段观测报告</div>
      <div>对应公开站 <code>/blog/report/</code>（文章页顶部入口）。统计数在构建时自动演算，文字总结、里程碑与精选可在此编排。</div>
    </div>
    ${rows}`;

  listEl.querySelectorAll('[data-rep-select]').forEach((card) => {
    card.addEventListener('click', () => {
      if (reportDirty && !confirm('当前观测报告有未保存修改，确定切换？')) return;
      const item = (reportDoc.reports || []).find((x) => x.id === card.dataset.repSelect);
      if (item) renderReportEditor(item, { isNew: false });
    });
  });
}

function renderReportEditor(item = {}, { isNew = false } = {}) {
  currentReportId = isNew ? null : (item.id || null);
  $('#editorTitle').textContent = isNew ? '新建阶段观测报告' : `年报：${item.title || item.id}`;
  $('#btnDelete').style.display = isNew ? 'none' : '';
  $('#btnSave').style.display = '';
  $('#btnSave').disabled = false;

  const selPosts = new Set(item.featuredPosts || []);
  const selDailies = new Set(item.featuredDailies || []);
  const allPosts = (ctx.getPosts() || []).filter((p) => !p.draft).sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
  const milestones = Array.isArray(item.milestones) && item.milestones.length ? item.milestones : [];

  $('#editorContainer').innerHTML = `
    <div class="editor">
      <div class="field-hint" id="repPreviewStats" style="padding:8px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px"></div>
      <section class="form-section">
        <div class="form-section-head"><span>报告期数与时间区间</span></div>
        <div class="form-section-body">
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>报告标题</label><input id="fRepTitle" value="${escAttr(item.title || '')}" placeholder="如：2026 年度观测报告" /></div>
            <div class="form-group" style="flex:1"><label>报告 ID</label><input id="fRepId" value="${escAttr(item.id || '')}" placeholder="如：2026-annual" ${isNew ? '' : 'readonly style="opacity:.75"'} /></div>
            <div class="form-group" style="flex:1"><label>期号标注</label><input id="fRepPeriodLabel" value="${escAttr(item.periodLabel || '')}" placeholder="如：YEAR · 2026" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>副标题</label><input id="fRepSubtitle" value="${escAttr(item.subtitle || '')}" placeholder="一句话总结这一阶段" /></div>
            <div class="form-group" style="max-width:150px"><label>起始日期（留空不限）</label><input id="fRepStart" type="date" value="${escAttr(item.dateStart || '')}" /></div>
            <div class="form-group" style="max-width:150px"><label>结束日期（留空不限）</label><input id="fRepEnd" type="date" value="${escAttr(item.dateEnd || '')}" /></div>
            <div class="form-group" style="max-width:74px"><label>排序</label><input id="fRepOrder" type="number" value="${Number(item.order) || ((reportDoc.reports || []).length + 1)}" /></div>
          </div>
          <div class="form-row">
            <label class="toggle-row" style="cursor:pointer"><input type="checkbox" id="fRepPublished" ${item.published !== false ? 'checked' : ''} /><span>公开展示在 /blog/report/</span></label>
            <label class="toggle-row" style="cursor:pointer"><input type="checkbox" id="fRepSetActive" ${item.id && item.id === reportDoc.activeReportId ? 'checked' : ''} /><span>设为默认打开的主报告</span></label>
          </div>
          <div class="form-group"><label>年度总结引言</label><textarea id="fRepSummary" rows="3" placeholder="阶段观测述评…">${esc(item.summary || '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label>年度关键词（逗号分隔）</label><input id="fRepKeywords" value="${escAttr((item.keywords || []).join(', '))}" placeholder="转专业, 临床医学, Agent, HORIZON" /></div>
            <div class="form-group"><label>结语引言 (outroQuote)</label><input id="fRepOutro" value="${escAttr(item.outroQuote || '')}" placeholder="下一观测周期继续校对坐标。" /></div>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>关键里程碑 (${milestones.length} 条)</span></div>
        <div class="form-section-body">
          <div id="repMilestonesList" style="display:flex;flex-direction:column;gap:8px">
            ${milestones.map(milestoneRowHtml).join('')}
          </div>
          <div style="margin-top:8px">
            <button type="button" class="btn small" id="btnRepAddMilestone">＋ 添加里程碑</button>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-head"><span>精选代表作与日常片段</span></div>
        <div class="form-section-body">
          <div class="form-group">
            <label>年度代表文章 (${selPosts.size} 篇已选)</label>
            <input id="fRepPostSearch" type="search" placeholder="筛选文章…" style="margin-bottom:6px" />
            <div class="rel-post-picker" id="repFeaturedPosts">
              ${allPosts.map((p) => `
                <label class="rel-post-option" data-search="${escAttr(`${p.title || ''} ${p.slug}`.toLowerCase())}">
                  <input type="checkbox" value="${escAttr(p.slug)}" ${selPosts.has(p.slug) ? 'checked' : ''} />
                  <span class="rpo-title">${esc(p.title || p.slug)}</span>
                  <span class="rpo-meta">${esc(p.pubDate || '')}</span>
                </label>`).join('')}
            </div>
          </div>
          <div class="form-group" style="margin-top:10px">
            <label>精选日常碎片 (${selDailies.size} 条已选)</label>
            <div class="rel-post-picker" id="repFeaturedDailies" style="max-height:170px">
              ${dailyItemsCache.slice(0, 80).map((d) => `
                <label class="rel-post-option">
                  <input type="checkbox" value="${escAttr(d.id)}" ${selDailies.has(d.id) ? 'checked' : ''} />
                  <span class="rpo-title">${esc((d.text || '(图集动态)').slice(0, 60))}</span>
                  <span class="rpo-meta">${esc(d.date || d.id)}</span>
                </label>`).join('')}
            </div>
          </div>
        </div>
      </section>
    </div>`;

  refreshPeriodPreviewStats();
  renderReportSidebar();
  markReportBaseline();

  const msHost = $('#repMilestonesList');
  msHost?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-ms-del]');
    if (del) {
      del.closest('.milestone-edit-row')?.remove();
      syncReportDirty();
    }
  });
  $('#btnRepAddMilestone')?.addEventListener('click', () => {
    msHost?.insertAdjacentHTML('beforeend', milestoneRowHtml({}));
    syncReportDirty();
  });

  const edHost = $('#editorContainer > .editor');
  edHost?.addEventListener('input', (e) => {
    if (e.target.id === 'fRepPostSearch') {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#repFeaturedPosts .rel-post-option').forEach((opt) => {
        opt.hidden = Boolean(q && !opt.dataset.search.includes(q));
      });
      return;
    }
    if (e.target.id === 'fRepStart' || e.target.id === 'fRepEnd') refreshPeriodPreviewStats();
    syncReportDirty();
  });
  edHost?.addEventListener('change', (e) => {
    if (e.target.id === 'fRepStart' || e.target.id === 'fRepEnd') refreshPeriodPreviewStats();
    syncReportDirty();
  });
}

export function newReportItem({ skipLeaveGuard = false } = {}) {
  if (!skipLeaveGuard && reportDirty && !confirm('当前观测报告有未保存修改，确定新建？')) return;
  renderReportEditor({ published: true }, { isNew: true });
}

export async function loadReports() {
  try {
    const [repRes, dailyRes] = await Promise.all([
      apiFetch(REPORTS_API),
      apiFetch('/api/daily').catch(() => null),
    ]);
    const data = await repRes.json();
    if (!repRes.ok || data.error) { toast(data.error || '加载观测报告失败'); return; }
    if (dailyRes && dailyRes.ok) {
      const d = await dailyRes.json().catch(() => []);
      if (Array.isArray(d)) dailyItemsCache = d;
    }
    reportDoc = { activeReportId: data.activeReportId || '', reports: Array.isArray(data.reports) ? data.reports : [] };
    reportHash = data.contentHash || '';
    const active = reportDoc.reports.find((r) => r.id === currentReportId)
      || reportDoc.reports.find((r) => r.id === reportDoc.activeReportId)
      || reportDoc.reports[0];
    if (active) renderReportEditor(active, { isNew: false });
    else renderReportEditor({ published: true }, { isNew: true });
  } catch (err) { toast('加载观测报告失败: ' + err.message); }
}

export async function saveReportItem() {
  if (reportSaving) return;
  const payload = readReportFormPayload();
  if (!payload) return;
  if (!payload.title) { toast('请填写报告标题'); return; }
  reportSaving = true;
  const saveBtn = $('#btnSave');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 保存中…'; }
  try {
    const isEdit = Boolean(currentReportId);
    const url = isEdit ? `${REPORTS_API}/${encodeURIComponent(currentReportId)}` : REPORTS_API;
    const method = isEdit ? 'PUT' : 'POST';
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, expectedHash: reportHash }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) toast('报告数据版本冲突，请点「↻ 刷新」');
      else toast(data.error || '保存失败');
      return;
    }
    reportDoc = { activeReportId: data.activeReportId || '', reports: data.reports || reportDoc.reports };
    reportHash = data.contentHash || reportHash;
    currentReportId = data.item?.id || currentReportId;
    clearReportDirty();
    if (data.item) renderReportEditor(data.item, { isNew: false });
    toast('观测报告已保存（点击顶栏「发布」上线）');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
  } catch (err) { toast('保存报告失败: ' + err.message); }
  finally {
    reportSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存 (Ctrl+S)'; }
  }
}

export async function deleteReportItem(id = currentReportId) {
  if (!id) return;
  const item = (reportDoc.reports || []).find((r) => r.id === id);
  if (!confirm(`确定删除报告「${item?.title || id}」？`)) return;
  try {
    const res = await apiFetch(`${REPORTS_API}/${encodeURIComponent(id)}?expectedHash=${encodeURIComponent(reportHash)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || data.error) { toast(data.error || '删除失败'); return; }
    reportDoc = { activeReportId: data.activeReportId || '', reports: data.reports || [] };
    reportHash = data.contentHash || reportHash;
    currentReportId = null;
    clearReportDirty();
    const next = reportDoc.reports[0];
    if (next) renderReportEditor(next, { isNew: false });
    else renderReportEditor({ published: true }, { isNew: true });
    toast('已删除观测报告');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
  } catch (err) { toast('删除失败: ' + err.message); }
}
