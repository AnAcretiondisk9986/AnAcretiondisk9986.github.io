/**
 * 日程与课表管理（src/data/schedule.json，带版本冲突校验）。
 * 仅在管理后台提供 WMU 课表 PDF 解析、JSON 导入/导出与课程/自定义日程的完整增删改；
 * 公开主站「07 日程」只读展示保存后的 schedule.json。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { apiFetch } from '../api/app-client.js';
import { parseTimetablePdf } from '../lib/wmu-timetable.mjs';
import { fetchWmuSyncSchedule } from '../lib/wmu-sync-import.mjs';
import {
  DAY_NAMES,
  ACTIVITY_LABELS,
  clampSlotHeight,
  courseAliasKey,
  eventFromParsed,
  favoriteKey,
  mondayOf,
  normalizeSchedulePayload,
  parseWeekRangesText,
  toIso,
  weeksLabel,
} from '/admin/shared/schedule-core.mjs';

const SCHEDULE_API = '/api/schedule';
const GITHUB_SYNC_PREFS_KEY = 'blog_admin_sched_gh_sync_v1';
const DEFAULT_GITHUB_SYNC_REPO = 'AnAcretiondisk9986/wmu-timetable-sync';
const COLOR_OPTIONS = [
  ['', '默认'],
  ['brand', '校红'],
  ['gold', '金色'],
  ['blue', '蓝色'],
  ['mint', '青绿'],
  ['violet', '紫灰'],
];

let scheduleState = {
  version: 2,
  timetables: [],
  activeId: null,
  favorites: [],
  slotHeight: 72,
  hideEmptyWeekends: false,
  updatedAt: 0,
};
let selectedTimetableId = null;
let courseFilterText = '';
let courseFilterDay = '';
let editingCourseIndex = -1;
let editingCustomIndex = -1;
let scheduleHash = '';
let scheduleBaseline = '';
let scheduleDirty = false;
let scheduleActive = false;
let pdfjsLibPromise = null;

let ctx = {
  onDirtyChange: () => {},
};

export function initSchedule(options = {}) {
  ctx = { ...ctx, ...options };
  bindGithubSyncModal();
}
export function isScheduleDirty() {
  return scheduleDirty;
}
export function clearScheduleDirty() {
  scheduleDirty = false;
  scheduleBaseline = '';
  scheduleActive = false;
  ctx.onDirtyChange(false);
}

function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('/admin/vendor/pdfjs/build/pdf.min.mjs')
      .then((mod) => {
        const lib = mod.default && mod.default.getDocument ? mod.default : mod;
        lib.GlobalWorkerOptions.workerSrc = '/admin/vendor/pdfjs/build/pdf.worker.min.mjs';
        return lib;
      })
      .catch((err) => {
        pdfjsLibPromise = null;
        throw err;
      });
  }
  return pdfjsLibPromise;
}

function currentSnapshot() {
  return JSON.stringify({
    version: 2,
    timetables: scheduleState.timetables,
    activeId: scheduleState.activeId,
    favorites: scheduleState.favorites,
    slotHeight: scheduleState.slotHeight,
    hideEmptyWeekends: scheduleState.hideEmptyWeekends,
  });
}

function markBaseline() {
  scheduleActive = true;
  scheduleBaseline = currentSnapshot();
  scheduleDirty = false;
  ctx.onDirtyChange(false);
  const btn = $('#btnSave');
  if (btn) btn.disabled = true;
}

function syncDirty() {
  if (!scheduleActive) return;
  const next = currentSnapshot() !== scheduleBaseline;
  scheduleDirty = next;
  ctx.onDirtyChange(next);
  const btn = $('#btnSave');
  if (btn) btn.disabled = !next;
}

function selectedTimetable() {
  return scheduleState.timetables.find((t) => t.id === selectedTimetableId)
    || scheduleState.timetables.find((t) => t.id === scheduleState.activeId)
    || scheduleState.timetables[0]
    || null;
}

function uniqueTimetableName(base) {
  const names = new Set(scheduleState.timetables.map((t) => t.name));
  if (!names.has(base)) return base;
  let idx = 2;
  while (names.has(`${base}（${idx}）`)) idx += 1;
  return `${base}（${idx}）`;
}

function getCourseAlias(tt, ev) {
  const key = courseAliasKey(ev);
  if (!key || !Array.isArray(tt?.courseAliases)) return '';
  return tt.courseAliases.find((a) => a.key === key)?.global || '';
}

function setCourseAlias(tt, ev, aliasText) {
  const key = courseAliasKey(ev);
  if (!tt || !key) return;
  if (!Array.isArray(tt.courseAliases)) tt.courseAliases = [];
  const trimmed = String(aliasText || '').trim().slice(0, 80);
  let entry = tt.courseAliases.find((a) => a.key === key);
  if (trimmed) {
    if (!entry) {
      entry = { key, global: trimmed, weeks: {} };
      tt.courseAliases.push(entry);
    } else {
      entry.global = trimmed;
    }
  } else if (entry) {
    entry.global = '';
    if (!Object.keys(entry.weeks || {}).length) {
      tt.courseAliases = tt.courseAliases.filter((a) => a !== entry);
    }
  }
}

function weeksToEditText(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) return '1-16周';
  return weeks.map((r) => {
    const base = r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    return `${base}周${r.parity === 'odd' ? '(单)' : r.parity === 'even' ? '(双)' : ''}`;
  }).join(', ');
}

function renderScheduleSidebar() {
  const listEl = $('#postList');
  if (!listEl) return;
  const tts = scheduleState.timetables;
  const rows = tts.length
    ? tts.map((tt) => {
        const isSelected = tt.id === selectedTimetable()?.id;
        const isActive = tt.id === scheduleState.activeId;
        return `<div class="post-card${isSelected ? ' active' : ''}" data-tt-select="${escAttr(tt.id)}">
          <div class="title">${esc(tt.name)} ${isActive ? '<span class="badge authorized">默认展示</span>' : ''}</div>
          <div class="meta">${esc(tt.semester || '未设学期')} · ${(tt.events || []).length} 课次 · ${(tt.customEvents || []).length} 日程</div>
          <div class="post-card-actions" style="margin-top:6px">
            ${isActive ? '' : `<button class="btn small" type="button" data-tt-activate="${escAttr(tt.id)}">设为默认</button>`}
            <button class="btn small danger" type="button" data-tt-delete="${escAttr(tt.id)}">删除</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:20px">暂无课表，请点击上方导入 PDF 或新建课表</div>';

  listEl.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-faint);line-height:1.8">
      <div style="color:var(--accent);margin-bottom:4px">07 · 日程与课表（对应主站 06 日程）</div>
      <div>课程表与自定义日程由后台维护，保存后点击顶栏「发布」推送到主站。</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        <button class="btn small primary" type="button" id="btnSchedPdf">⤓ 导入 WMU PDF</button>
        <button class="btn small" type="button" id="btnSchedGithubImport">↻ 同步仓库导入</button>
        <button class="btn small" type="button" id="btnSchedNewTt">＋ 新建课表</button>
        <button class="btn small" type="button" id="btnSchedImportJson">导入 JSON</button>
        <button class="btn small" type="button" id="btnSchedExportJson">导出 JSON</button>
      </div>
      <input type="file" id="fSchedPdfInput" accept="application/pdf" style="display:none" />
      <input type="file" id="fSchedJsonInput" accept="application/json" style="display:none" />
    </div>
    ${rows}`;

  $('#btnSchedPdf')?.addEventListener('click', () => $('#fSchedPdfInput')?.click());
  $('#btnSchedGithubImport')?.addEventListener('click', () => openGithubSyncModal());
  $('#btnSchedNewTt')?.addEventListener('click', () => createBlankTimetable());
  $('#btnSchedImportJson')?.addEventListener('click', () => $('#fSchedJsonInput')?.click());
  $('#btnSchedExportJson')?.addEventListener('click', () => exportScheduleJson());

  $('#fSchedPdfInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await handleAdminPdfImport(file);
  });
  $('#fSchedJsonInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await handleAdminJsonImport(file);
  });

  listEl.querySelectorAll('[data-tt-select]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-tt-activate], [data-tt-delete]')) return;
      selectedTimetableId = card.dataset.ttSelect;
      editingCourseIndex = -1;
      editingCustomIndex = -1;
      renderScheduleSidebar();
      renderScheduleEditor();
    });
  });
  listEl.querySelectorAll('[data-tt-activate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      scheduleState.activeId = btn.dataset.ttActivate;
      syncDirty();
      renderScheduleSidebar();
      renderScheduleEditor();
      toast('已切换默认展示课表（请记得保存）');
    });
  });
  listEl.querySelectorAll('[data-tt-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.ttDelete;
      const tt = scheduleState.timetables.find((item) => item.id === id);
      if (!tt || !confirm(`确定删除课表「${tt.name}」吗？`)) return;
      scheduleState.timetables = scheduleState.timetables.filter((item) => item.id !== id);
      if (scheduleState.activeId === id) {
        scheduleState.activeId = scheduleState.timetables[0]?.id || null;
      }
      if (selectedTimetableId === id) {
        selectedTimetableId = scheduleState.activeId;
      }
      editingCourseIndex = -1;
      editingCustomIndex = -1;
      syncDirty();
      renderScheduleSidebar();
      renderScheduleEditor();
    });
  });
}

function renderCourseForm(tt) {
  if (editingCourseIndex === -1) return '';
  const isNew = editingCourseIndex === -2;
  const ev = isNew
    ? {
        day: 1,
        start: 1,
        end: 2,
        title: '',
        type: 'lecture',
        label: '讲课',
        room: '',
        campus: '茶山校区',
        teacher: '',
        weeks: [{ start: 1, end: 16, parity: 'all' }],
        credit: '',
        courseCode: '',
        assessment: '',
        note: '',
        cardColor: '',
        hidden: false,
      }
    : tt.events[editingCourseIndex];
  if (!ev) return '';
  const aliasVal = isNew ? '' : getCourseAlias(tt, ev);
  return `
    <div class="panel" style="border:1px solid var(--accent-line);padding:12px;margin-top:8px;background:var(--surface-3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="color:var(--accent);font-size:12px">${isNew ? '新增课程' : `编辑课程：${esc(ev.title)}`}</strong>
        <button class="btn small" type="button" id="btnCancelCourseEdit">取消</button>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>课程名称 *</label><input id="fCourseTitle" value="${escAttr(ev.title)}" /></div>
        <div class="form-group" style="flex:1"><label>全局别名（可选）</label><input id="fCourseAlias" value="${escAttr(aliasVal)}" placeholder="留空显示原名" /></div>
        <div class="form-group" style="flex:1"><label>类型</label><select id="fCourseType">${Object.entries(ACTIVITY_LABELS).filter(([k]) => k !== 'custom').map(([k, v]) => `<option value="${k}"${ev.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>星期</label><select id="fCourseDay">${DAY_NAMES.map((d, i) => `<option value="${i + 1}"${ev.day === i + 1 ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="form-group"><label>开始节次</label><input id="fCourseStart" type="number" min="1" max="22" value="${ev.start}" /></div>
        <div class="form-group"><label>结束节次</label><input id="fCourseEnd" type="number" min="1" max="22" value="${ev.end}" /></div>
        <div class="form-group" style="flex:2"><label>周次（如 1-16周, 18周(单)）</label><input id="fCourseWeeks" value="${escAttr(weeksToEditText(ev.weeks))}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>校区</label><input id="fCourseCampus" value="${escAttr(ev.campus)}" placeholder="茶山校区 / 滨海校区 / 线上" /></div>
        <div class="form-group"><label>教室 / 场地</label><input id="fCourseRoom" value="${escAttr(ev.room)}" /></div>
        <div class="form-group"><label>教师</label><input id="fCourseTeacher" value="${escAttr(ev.teacher)}" /></div>
        <div class="form-group"><label>学分</label><input id="fCourseCredit" value="${escAttr(ev.credit === '—' ? '' : (ev.credit ?? ''))}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>课程代码</label><input id="fCourseCode" value="${escAttr(ev.courseCode || '')}" /></div>
        <div class="form-group"><label>考核方式</label><input id="fCourseAssessment" value="${escAttr(ev.assessment || '')}" /></div>
        <div class="form-group"><label>卡片颜色</label><select id="fCourseColor">${COLOR_OPTIONS.map(([val, lbl]) => `<option value="${val}"${(ev.cardColor || '') === val ? ' selected' : ''}>${lbl}</option>`).join('')}</select></div>
        <div class="form-group"><label>状态</label><select id="fCourseHidden"><option value="false"${!ev.hidden ? ' selected' : ''}>显示</option><option value="true"${ev.hidden ? ' selected' : ''}>隐藏</option></select></div>
      </div>
      <div class="form-group"><label>选课备注</label><input id="fCourseNote" value="${escAttr(ev.note || '')}" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn primary small" type="button" id="btnApplyCourseEdit">应用到列表</button>
      </div>
    </div>`;
}

function renderCustomForm(tt) {
  if (editingCustomIndex === -1) return '';
  const isNew = editingCustomIndex === -2;
  const ev = isNew
    ? {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'custom',
        title: '',
        description: '',
        room: '',
        week: 1,
        day: 1,
        startTime: '19:00',
        endTime: '20:30',
        color: 'brand',
        hidden: false,
      }
    : (tt.customEvents || [])[editingCustomIndex];
  if (!ev) return '';
  return `
    <div class="panel" style="border:1px solid var(--accent-line);padding:12px;margin-top:8px;background:var(--surface-3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="color:var(--accent);font-size:12px">${isNew ? '新增自定义日程' : `编辑日程：${esc(ev.title)}`}</strong>
        <button class="btn small" type="button" id="btnCancelCustomEdit">取消</button>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>日程标题 *</label><input id="fCustomTitle" value="${escAttr(ev.title)}" /></div>
        <div class="form-group" style="flex:1"><label>地点</label><input id="fCustomRoom" value="${escAttr(ev.room || '')}" /></div>
        <div class="form-group" style="flex:1"><label>颜色</label><select id="fCustomColor">${COLOR_OPTIONS.filter(([v]) => v).map(([val, lbl]) => `<option value="${val}"${ev.color === val ? ' selected' : ''}>${lbl}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>周次</label><input id="fCustomWeek" type="number" min="-52" max="99" value="${ev.week}" /></div>
        <div class="form-group"><label>星期</label><select id="fCustomDay">${DAY_NAMES.map((d, i) => `<option value="${i + 1}"${ev.day === i + 1 ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="form-group"><label>开始时间</label><input id="fCustomStart" type="time" value="${escAttr(ev.startTime)}" /></div>
        <div class="form-group"><label>结束时间</label><input id="fCustomEnd" type="time" value="${escAttr(ev.endTime)}" /></div>
        <div class="form-group"><label>状态</label><select id="fCustomHidden"><option value="false"${!ev.hidden ? ' selected' : ''}>显示</option><option value="true"${ev.hidden ? ' selected' : ''}>隐藏</option></select></div>
      </div>
      <div class="form-group"><label>简介 / 备注</label><input id="fCustomDesc" value="${escAttr(ev.description || '')}" /></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn primary small" type="button" id="btnApplyCustomEdit">应用到列表</button>
      </div>
    </div>`;
}

function renderScheduleEditor() {
  const container = $('#editorContainer');
  if (!container) return;
  const tt = selectedTimetable();
  $('#editorTitle').textContent = tt ? `日程管理：${tt.name}` : '日程管理（尚未创建课表）';
  $('#btnDelete').style.display = 'none';

  const globalSection = `
    <section class="frontend-section">
      <h3>主站「07 日程」全局显示偏好</h3>
      <div class="form-row">
        <div class="form-group"><label>每 45 分钟格高 (px, 48–144)</label><input id="fSchedSlotHeight" type="number" min="48" max="144" step="4" value="${scheduleState.slotHeight}" /></div>
        <div class="form-group"><label>默认隐藏无课周末列</label><select id="fSchedHideWeekends"><option value="false"${!scheduleState.hideEmptyWeekends ? ' selected' : ''}>显示全部 7 天</option><option value="true"${scheduleState.hideEmptyWeekends ? ' selected' : ''}>隐藏无课周末</option></select></div>
      </div>
    </section>`;

  if (!tt) {
    container.innerHTML = `<div class="editor frontend-editor">${globalSection}
      <section class="frontend-section">
        <h3>尚未添加课表</h3>
        <p class="field-hint">可在左侧点击「⤓ 导入 WMU PDF」直接解析温医大教务系统 PDF 课表，或点击「＋ 新建课表」手动创建空白课表。</p>
      </section>
    </div>`;
    bindGlobalFields();
    return;
  }

  const q = courseFilterText.trim().toLowerCase();
  const filteredCourses = (tt.events || []).map((ev, idx) => ({ ev, idx })).filter(({ ev }) => {
    if (courseFilterDay && String(ev.day) !== courseFilterDay) return false;
    if (q) {
      const hay = `${ev.title} ${getCourseAlias(tt, ev)} ${ev.teacher} ${ev.room} ${ev.campus} ${ev.courseCode || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const customList = (tt.customEvents || []).map((ev, idx) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border);background:var(--surface-1);border-radius:4px">
      <div style="min-width:0">
        <div style="font-size:12px;color:var(--text)">${esc(ev.title)} ${ev.hidden ? '<span class="badge draft">已隐藏</span>' : ''}</div>
        <div style="font-size:10px;color:var(--text-faint)">第 ${ev.week} 周 · ${DAY_NAMES[ev.day - 1]} ${esc(ev.startTime)}–${esc(ev.endTime)}${ev.room ? ` · ${esc(ev.room)}` : ''}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn small" type="button" data-custom-edit="${idx}">编辑</button>
        <button class="btn small danger" type="button" data-custom-del="${idx}">删除</button>
      </div>
    </div>`).join('') || '<div class="field-hint">暂无自定义日程</div>';

  const courseList = filteredCourses.map(({ ev, idx }) => {
    const alias = getCourseAlias(tt, ev);
    const fav = scheduleState.favorites.includes(favoriteKey(ev, tt.id));
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border);background:var(--surface-1);border-radius:4px">
        <div style="min-width:0">
          <div style="font-size:12px;color:var(--text)">
            ${esc(alias || ev.title)}${alias ? ` <span class="field-hint">（原：${esc(ev.title)}）</span>` : ''}
            <span class="badge">${esc(ev.label)}</span>
            ${fav ? '<span class="badge authorized">★ 收藏</span>' : ''}
            ${ev.hidden ? '<span class="badge draft">已隐藏</span>' : ''}
          </div>
          <div style="font-size:10px;color:var(--text-faint)">
            ${DAY_NAMES[ev.day - 1]} 第 ${ev.start}–${ev.end} 节 · ${esc(weeksLabel(ev.weeks))} · ${esc(ev.campus)} · ${esc(ev.room)} · ${esc(ev.teacher)}
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn small" type="button" data-course-fav="${idx}" title="切换收藏">${fav ? '★' : '☆'}</button>
          <button class="btn small" type="button" data-course-hide="${idx}">${ev.hidden ? '显示' : '隐藏'}</button>
          <button class="btn small" type="button" data-course-edit="${idx}">编辑</button>
          <button class="btn small danger" type="button" data-course-del="${idx}">删除</button>
        </div>
      </div>`;
  }).join('') || '<div class="field-hint">没有匹配的课程</div>';

  container.innerHTML = `
    <div class="editor frontend-editor">
      ${globalSection}

      <section class="frontend-section">
        <h3>课表元数据（${esc(tt.name)}）</h3>
        <div class="form-row">
          <div class="form-group" style="flex:1"><label>课表名称</label><input id="fTtName" value="${escAttr(tt.name)}" /></div>
          <div class="form-group" style="flex:1"><label>学期标识（如 2026-2027-1）</label><input id="fTtSemester" value="${escAttr(tt.semester || '')}" /></div>
          <div class="form-group" style="flex:1"><label>学期第一周周一</label><input id="fTtStart" type="date" value="${escAttr(tt.termStartDate || '')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1"><label>备注姓名（仅后台参考，主站不展示学号）</label><input id="fTtStudentName" value="${escAttr(tt.student?.name || '')}" /></div>
          <div class="form-group" style="flex:1"><label>开学日期已确认</label><select id="fTtConfirmed"><option value="true"${tt.termStartConfirmed ? ' selected' : ''}>已确认</option><option value="false"${!tt.termStartConfirmed ? ' selected' : ''}>待确认</option></select></div>
        </div>
      </section>

      <section class="frontend-section">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>自定义日程（${(tt.customEvents || []).length}）</h3>
          <button class="btn small primary" type="button" id="btnAddCustomEvent">＋ 添加自定义日程</button>
        </div>
        ${editingCustomIndex !== -1 ? renderCustomForm(tt) : ''}
        <div style="display:flex;flex-direction:column;gap:6px">${customList}</div>
      </section>

      <section class="frontend-section">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
          <h3>课程列表（${(tt.events || []).length} 课次）</h3>
          <div style="display:flex;gap:6px;align-items:center">
            <input id="fCourseSearch" value="${escAttr(courseFilterText)}" placeholder="筛选课程 / 教师 / 教室…" style="width:180px" />
            <select id="fCourseDayFilter" style="width:96px">
              <option value="">全部星期</option>
              ${DAY_NAMES.map((d, i) => `<option value="${i + 1}"${courseFilterDay === String(i + 1) ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
            <button class="btn small primary" type="button" id="btnAddCourse">＋ 新增课程</button>
          </div>
        </div>
        ${editingCourseIndex !== -1 ? renderCourseForm(tt) : ''}
        <div style="display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto">${courseList}</div>
      </section>
    </div>`;

  bindGlobalFields();
  bindTimetableFields(tt);
  bindCourseAndCustomActions(tt);
}

function bindGlobalFields() {
  $('#fSchedSlotHeight')?.addEventListener('change', (e) => {
    scheduleState.slotHeight = clampSlotHeight(e.target.value);
    e.target.value = String(scheduleState.slotHeight);
    syncDirty();
  });
  $('#fSchedHideWeekends')?.addEventListener('change', (e) => {
    scheduleState.hideEmptyWeekends = e.target.value === 'true';
    syncDirty();
  });
}

function bindTimetableFields(tt) {
  $('#fTtName')?.addEventListener('input', (e) => {
    tt.name = e.target.value.trim() || '课表';
    syncDirty();
    renderScheduleSidebar();
  });
  $('#fTtSemester')?.addEventListener('input', (e) => {
    tt.semester = e.target.value.trim();
    syncDirty();
  });
  $('#fTtStart')?.addEventListener('change', (e) => {
    if (e.target.value) {
      const normalized = toIso(mondayOf(new Date(`${e.target.value}T00:00:00`)));
      tt.termStartDate = normalized;
      e.target.value = normalized;
      tt.termStartConfirmed = true;
      const conf = $('#fTtConfirmed');
      if (conf) conf.value = 'true';
      syncDirty();
    }
  });
  $('#fTtStudentName')?.addEventListener('input', (e) => {
    if (!tt.student) tt.student = { name: '', id: '' };
    tt.student.name = e.target.value.trim();
    syncDirty();
  });
  $('#fTtConfirmed')?.addEventListener('change', (e) => {
    tt.termStartConfirmed = e.target.value === 'true';
    syncDirty();
  });
}

function bindCourseAndCustomActions(tt) {
  $('#fCourseSearch')?.addEventListener('input', (e) => {
    courseFilterText = e.target.value;
    renderScheduleEditor();
    const input = $('#fCourseSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  $('#fCourseDayFilter')?.addEventListener('change', (e) => {
    courseFilterDay = e.target.value;
    renderScheduleEditor();
  });

  $('#btnAddCourse')?.addEventListener('click', () => {
    editingCourseIndex = -2;
    renderScheduleEditor();
  });
  $('#btnCancelCourseEdit')?.addEventListener('click', () => {
    editingCourseIndex = -1;
    renderScheduleEditor();
  });
  $('#btnApplyCourseEdit')?.addEventListener('click', () => {
    const title = $('#fCourseTitle')?.value.trim();
    if (!title) { toast('课程名称不能为空'); return; }
    const start = Number($('#fCourseStart')?.value);
    const end = Number($('#fCourseEnd')?.value);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 22 || end < start) {
      toast('节次范围需在 1–22 之间且结束节次不早于开始节次');
      return;
    }
    const weeks = parseWeekRangesText($('#fCourseWeeks')?.value);
    if (!weeks.length) { toast('请输入有效周次，例如 1-16周'); return; }
    const type = $('#fCourseType')?.value || 'lecture';
    const nextEv = {
      day: Number($('#fCourseDay')?.value) || 1,
      start,
      end,
      title,
      type,
      label: ACTIVITY_LABELS[type] || '讲课',
      campus: $('#fCourseCampus')?.value.trim() || '未标注校区',
      room: $('#fCourseRoom')?.value.trim() || '待定',
      teacher: $('#fCourseTeacher')?.value.trim() || '待定',
      weeks,
      credit: $('#fCourseCredit')?.value.trim() || '—',
      courseCode: $('#fCourseCode')?.value.trim() || '',
      className: editingCourseIndex >= 0 ? (tt.events[editingCourseIndex]?.className || '') : '',
      classComposition: editingCourseIndex >= 0 ? (tt.events[editingCourseIndex]?.classComposition || '') : '',
      assessment: $('#fCourseAssessment')?.value.trim() || '',
      note: $('#fCourseNote')?.value.trim() || '',
      courseHours: editingCourseIndex >= 0 ? (tt.events[editingCourseIndex]?.courseHours || '') : '',
      weeklyHours: editingCourseIndex >= 0 ? (tt.events[editingCourseIndex]?.weeklyHours ?? null) : null,
      totalHours: editingCourseIndex >= 0 ? (tt.events[editingCourseIndex]?.totalHours ?? null) : null,
      cardColor: $('#fCourseColor')?.value || '',
      hidden: $('#fCourseHidden')?.value === 'true',
    };
    if (editingCourseIndex === -2) tt.events.push(nextEv);
    else if (editingCourseIndex >= 0) tt.events[editingCourseIndex] = nextEv;
    setCourseAlias(tt, nextEv, $('#fCourseAlias')?.value || '');
    editingCourseIndex = -1;
    syncDirty();
    renderScheduleSidebar();
    renderScheduleEditor();
  });

  $('#btnAddCustomEvent')?.addEventListener('click', () => {
    editingCustomIndex = -2;
    renderScheduleEditor();
  });
  $('#btnCancelCustomEdit')?.addEventListener('click', () => {
    editingCustomIndex = -1;
    renderScheduleEditor();
  });
  $('#btnApplyCustomEdit')?.addEventListener('click', () => {
    const title = $('#fCustomTitle')?.value.trim();
    const startTime = $('#fCustomStart')?.value;
    const endTime = $('#fCustomEnd')?.value;
    const week = Number($('#fCustomWeek')?.value);
    const day = Number($('#fCustomDay')?.value);
    if (!title) { toast('日程标题不能为空'); return; }
    if (!startTime || !endTime || endTime <= startTime) { toast('结束时间需晚于开始时间'); return; }
    if (!Number.isInteger(week) || week < -52 || week > 99) { toast('周次无效'); return; }
    if (!Array.isArray(tt.customEvents)) tt.customEvents = [];
    const existingId = editingCustomIndex >= 0 ? tt.customEvents[editingCustomIndex]?.id : '';
    const nextEv = {
      id: existingId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'custom',
      title,
      description: $('#fCustomDesc')?.value.trim() || '',
      room: $('#fCustomRoom')?.value.trim() || '',
      week,
      day,
      startTime,
      endTime,
      color: $('#fCustomColor')?.value || 'brand',
      type: 'custom',
      label: '自定义',
      campus: '',
      teacher: '',
      credit: '—',
      hidden: $('#fCustomHidden')?.value === 'true',
      weeks: [{ start: week, end: week, parity: 'all' }],
    };
    if (editingCustomIndex === -2) tt.customEvents.push(nextEv);
    else if (editingCustomIndex >= 0) tt.customEvents[editingCustomIndex] = nextEv;
    editingCustomIndex = -1;
    syncDirty();
    renderScheduleSidebar();
    renderScheduleEditor();
  });

  document.querySelectorAll('[data-course-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingCourseIndex = Number(btn.dataset.courseEdit);
      renderScheduleEditor();
    });
  });
  document.querySelectorAll('[data-course-hide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.courseHide);
      const ev = tt.events[idx];
      if (!ev) return;
      ev.hidden = !ev.hidden;
      syncDirty();
      renderScheduleEditor();
    });
  });
  document.querySelectorAll('[data-course-fav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.courseFav);
      const ev = tt.events[idx];
      if (!ev) return;
      const key = favoriteKey(ev, tt.id);
      if (!key) return;
      const pos = scheduleState.favorites.indexOf(key);
      if (pos >= 0) scheduleState.favorites.splice(pos, 1);
      else scheduleState.favorites.push(key);
      syncDirty();
      renderScheduleEditor();
    });
  });
  document.querySelectorAll('[data-course-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.courseDel);
      const ev = tt.events[idx];
      if (!ev || !confirm(`确定删除课程「${ev.title}」吗？`)) return;
      tt.events.splice(idx, 1);
      if (editingCourseIndex === idx) editingCourseIndex = -1;
      syncDirty();
      renderScheduleSidebar();
      renderScheduleEditor();
    });
  });
  document.querySelectorAll('[data-custom-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingCustomIndex = Number(btn.dataset.customEdit);
      renderScheduleEditor();
    });
  });
  document.querySelectorAll('[data-custom-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.customDel);
      const ev = tt.customEvents[idx];
      if (!ev || !confirm(`确定删除日程「${ev.title}」吗？`)) return;
      tt.customEvents.splice(idx, 1);
      if (editingCustomIndex === idx) editingCustomIndex = -1;
      syncDirty();
      renderScheduleSidebar();
      renderScheduleEditor();
    });
  });
}

function createBlankTimetable() {
  const id = `tt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tt = {
    id,
    name: uniqueTimetableName('新课表'),
    semester: '',
    student: { name: '', id: '' },
    termStartDate: toIso(mondayOf(new Date())),
    termStartConfirmed: true,
    events: [],
    customEvents: [],
    courseAliases: [],
    updatedAt: Date.now(),
  };
  scheduleState.timetables.push(tt);
  if (!scheduleState.activeId) scheduleState.activeId = id;
  selectedTimetableId = id;
  editingCourseIndex = -1;
  editingCustomIndex = -1;
  syncDirty();
  renderScheduleSidebar();
  renderScheduleEditor();
  toast('已新建空白课表（请添加课程后保存）');
}

async function handleAdminPdfImport(file) {
  toast('正在解析 WMU 课表 PDF…');
  try {
    const pdfjsLib = await loadPdfJs();
    const result = await parseTimetablePdf(file, pdfjsLib, {
      cMapUrl: '/admin/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/admin/vendor/pdfjs/standard_fonts/',
    });
    if (!Array.isArray(result.events) || !result.events.length) {
      toast('未在 PDF 中识别到课程记录');
      return;
    }
    const semester = result.semester || '未设置学期';
    const inherited = scheduleState.timetables.find((item) => item.semester === semester && item.termStartDate);
    const id = `tt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const parsedEvents = result.events.map(eventFromParsed);
    const tt = {
      id,
      name: uniqueTimetableName(semester),
      semester,
      student: { name: result.student?.name || '', id: '' }, // 默认不落盘学号，保护隐私
      termStartDate: inherited?.termStartDate || toIso(mondayOf(new Date())),
      termStartConfirmed: Boolean(inherited?.termStartDate && inherited?.termStartConfirmed),
      events: parsedEvents,
      customEvents: [],
      courseAliases: [],
      updatedAt: Date.now(),
    };
    const normalized = normalizeSchedulePayload({
      ...scheduleState,
      timetables: [...scheduleState.timetables, tt],
      activeId: id,
    });
    if (!normalized) {
      toast('解析结果校验失败');
      return;
    }
    scheduleState = normalized;
    selectedTimetableId = id;
    editingCourseIndex = -1;
    editingCustomIndex = -1;
    syncDirty();
    renderScheduleSidebar();
    renderScheduleEditor();
    const conflicts = result.conflicts?.length ? `（检测到 ${result.conflicts.length} 个跨校区冲突）` : '';
    toast(`已解析 ${parsedEvents.length} 个课次${conflicts}，请确认开学日期后保存`);
  } catch (err) {
    toast(`PDF 解析失败: ${err.message}`);
  }
}

function applyImportedSchedulePayload(raw, sourceLabel = '') {
  const normalized = normalizeSchedulePayload(raw);
  if (!normalized) {
    return { ok: false, error: 'JSON 格式不正确（仅支持 WMU 课表 v1/v2 数据）' };
  }
  // 清理学号字段以防意外发布个人敏感信息
  normalized.timetables.forEach((tt) => {
    if (tt.student) tt.student.id = '';
  });
  scheduleState = normalized;
  selectedTimetableId = normalized.activeId || normalized.timetables[0]?.id || null;
  editingCourseIndex = -1;
  editingCustomIndex = -1;
  syncDirty();
  renderScheduleSidebar();
  renderScheduleEditor();
  const suffix = sourceLabel ? `（${sourceLabel}）` : '';
  toast(`已导入 ${normalized.timetables.length} 份课表${suffix}，请核对后保存`);
  return { ok: true, count: normalized.timetables.length };
}

function readGithubSyncPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GITHUB_SYNC_PREFS_KEY) || '{}');
    return {
      repo: typeof parsed.repo === 'string' && parsed.repo.trim() ? parsed.repo.trim() : DEFAULT_GITHUB_SYNC_REPO,
      username: typeof parsed.username === 'string' ? parsed.username.trim() : '',
    };
  } catch {
    return { repo: DEFAULT_GITHUB_SYNC_REPO, username: '' };
  }
}

function saveGithubSyncPrefs(repo, username) {
  try {
    localStorage.setItem(GITHUB_SYNC_PREFS_KEY, JSON.stringify({
      repo: String(repo || '').trim(),
      username: String(username || '').trim(),
    }));
  } catch { /* ignore storage quota errors */ }
}

function setGithubModalStatus(message, isError = false) {
  const el = $('#schedGhStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--danger, #e05d5d)' : '';
}

function closeGithubSyncModal() {
  const tokenInput = $('#fSchedGhToken');
  if (tokenInput) tokenInput.value = '';
  closeModal($('#schedGithubModal'));
}

function openGithubSyncModal() {
  const modal = $('#schedGithubModal');
  if (!modal) return;
  const prefs = readGithubSyncPrefs();
  const repoInput = $('#fSchedGhRepo');
  const userInput = $('#fSchedGhUser');
  const tokenInput = $('#fSchedGhToken');
  if (repoInput) repoInput.value = prefs.repo;
  if (userInput) userInput.value = prefs.username;
  if (tokenInput) tokenInput.value = '';
  setGithubModalStatus('将从仓库读取 WMU 课表同步配置并自动清除学号字段，导入后请核对并保存。');
  openModal(modal);
}

let githubSyncModalBound = false;
function bindGithubSyncModal() {
  if (githubSyncModalBound) return;
  const modal = $('#schedGithubModal');
  if (!modal) return;
  githubSyncModalBound = true;
  $('#btnSchedGhCancel')?.addEventListener('click', closeGithubSyncModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeGithubSyncModal();
  });
  $('#btnSchedGhConfirm')?.addEventListener('click', handleGithubSyncImport);
}

async function handleGithubSyncImport() {
  const btn = $('#btnSchedGhConfirm');
  const repo = $('#fSchedGhRepo')?.value.trim() || '';
  const username = $('#fSchedGhUser')?.value.trim() || '';
  const token = $('#fSchedGhToken')?.value.trim() || '';
  if (!repo) {
    setGithubModalStatus('请填写同步仓库（所有者/仓库名）', true);
    return;
  }
  if (btn) btn.disabled = true;
  setGithubModalStatus('正在从 GitHub 同步仓库拉取课表配置…');
  try {
    const result = await fetchWmuSyncSchedule({ repo, username, token });
    const applied = applyImportedSchedulePayload(result.raw, `${result.owner}/${result.repo}`);
    if (!applied.ok) {
      setGithubModalStatus(applied.error, true);
      return;
    }
    saveGithubSyncPrefs(`${result.owner}/${result.repo}`, username ? result.username : '');
    closeGithubSyncModal();
  } catch (err) {
    setGithubModalStatus(err?.message || '同步仓库导入失败', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleAdminJsonImport(file) {
  try {
    const raw = JSON.parse(await file.text());
    const applied = applyImportedSchedulePayload(raw);
    if (!applied.ok) {
      toast(applied.error);
    }
  } catch (err) {
    toast(`导入 JSON 失败: ${err.message}`);
  }
}

function exportScheduleJson() {
  const blob = new Blob([JSON.stringify(scheduleState, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schedule-backup-${toIso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadSchedule() {
  try {
    const res = await apiFetch(SCHEDULE_API);
    const data = await res.json();
    if (!res.ok || data.error) {
      toast(data.error || `加载课表失败（HTTP ${res.status}）`);
      return;
    }
    scheduleHash = data.contentHash || '';
    const normalized = normalizeSchedulePayload(data);
    if (normalized) scheduleState = normalized;
    selectedTimetableId = scheduleState.activeId || scheduleState.timetables[0]?.id || null;
    editingCourseIndex = -1;
    editingCustomIndex = -1;
    renderScheduleSidebar();
    renderScheduleEditor();
    markBaseline();
  } catch (err) {
    toast('加载课表失败: ' + err.message);
  }
}

export async function saveSchedule() {
  try {
    const res = await apiFetch(SCHEDULE_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...scheduleState,
        expectedHash: scheduleHash,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) {
        toast('课表已被其他来源修改，请刷新后重试');
        return;
      }
      toast(data.error || '保存失败');
      return;
    }
    scheduleHash = data.contentHash || scheduleHash;
    if (data.schedule) scheduleState = data.schedule;
    clearScheduleDirty();
    toast('课表与日程已保存（点击顶栏「发布」推送上线）');
    await loadSchedule();
  } catch (err) {
    toast('保存失败: ' + err.message);
  }
}

export { renderScheduleSidebar };
