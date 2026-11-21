import { replayEnter } from './motion';

interface RawExam {
  year: string;
  term: number;
  course: string;
  date: string;
  start: string;
  end: string;
  room: string;
  campus: string;
  college: string;
  dept: string;
  tag?: string;
}

interface ExamPayload {
  year: string;
  term: number;
  termLabel: string;
  campus: string;
  sourceLabel?: string;
  exams: RawExam[];
}

interface ExamItem extends RawExam {
  id: string;
  tone: string;
  tag: string;
  rawStart: Date;
  rawEnd: Date;
  mins: number;
  wd: string;
}

type ViewMode = 'timeline' | 'grid' | 'table';
type SortMode = 'time' | 'course' | 'room' | 'college';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));

const collegeTone = (college: string): string => {
  if (college.includes('基础医学')) return 'med';
  if (college.includes('马克思主义')) return 'marx';
  if (college.includes('药学院')) return 'pharm';
  if (college.includes('眼视光') || college.includes('生物医学')) return 'optom';
  if (college.includes('外国语')) return 'lang';
  if (college.includes('CET') || college.includes('统考')) return 'cet';
  return 'default';
};

const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
};

const parseLocalDateTime = (dateStr: string, timeStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const daysBetween = (a: Date, b: Date) =>
  Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86_400_000);

const fmtDateCN = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

const shortCourse = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);

interface RelStatus {
  text: string;
  cls: '' | 'is-soon' | 'is-now' | 'is-over';
}

const examStatus = (exam: ExamItem, now: Date): RelStatus => {
  if (now > exam.rawEnd) return { text: '已结束', cls: 'is-over' };
  if (now >= exam.rawStart) return { text: '正在进行', cls: 'is-now' };
  const diffDays = daysBetween(now, exam.rawStart);
  if (diffDays === 0) return { text: '就在今天', cls: 'is-now' };
  if (diffDays === 1) return { text: '明天开考', cls: 'is-now' };
  if (diffDays <= 7) return { text: `还有 ${diffDays} 天`, cls: 'is-soon' };
  return { text: `还有 ${diffDays} 天`, cls: '' };
};

const dayStatus = (dateStr: string, items: ExamItem[], now: Date): RelStatus => {
  if (items.every((item) => now > item.rawEnd)) return { text: '已结束', cls: 'is-over' };
  if (items.some((item) => now >= item.rawStart && now <= item.rawEnd)) {
    return { text: '正在进行', cls: 'is-now' };
  }
  const diffDays = daysBetween(now, parseLocalDate(dateStr));
  if (diffDays === 0) return { text: '就在今天', cls: 'is-now' };
  if (diffDays === 1) return { text: '明天', cls: 'is-now' };
  if (diffDays < 0) return { text: '已结束', cls: 'is-over' };
  if (diffDays <= 7) return { text: `还有 ${diffDays} 天`, cls: 'is-soon' };
  return { text: `还有 ${diffDays} 天`, cls: '' };
};

function initExamPage() {
  const root = document.querySelector<HTMLElement>('[data-exam-root]');
  if (!root) return;
  const dataEl = document.querySelector<HTMLScriptElement>('script[data-exam-data]');
  if (!dataEl?.textContent) return;

  let payload: ExamPayload;
  try {
    payload = JSON.parse(dataEl.textContent) as ExamPayload;
  } catch {
    return;
  }

  const rawList = (payload.exams || []).map((raw, idx) => {
    const rawStart = parseLocalDateTime(raw.date, raw.start);
    const rawEnd = parseLocalDateTime(raw.date, raw.end);
    const mins = Math.max(0, Math.round((rawEnd.getTime() - rawStart.getTime()) / 60_000));
    return {
      ...raw,
      id: `exam-${idx}`,
      tone: collegeTone(raw.college),
      tag: String(raw.tag || '').trim(),
      rawStart,
      rawEnd,
      mins,
      wd: WEEKDAYS[parseLocalDate(raw.date).getDay()] || '',
    };
  });

  // 同一门课考两次时，时间较短的自动标注「实验考核」
  const courseMins = new Map<string, number[]>();
  for (const item of rawList) {
    const arr = courseMins.get(item.course);
    if (arr) arr.push(item.mins);
    else courseMins.set(item.course, [item.mins]);
  }
  const exams: ExamItem[] = rawList
    .map((item) => {
      if (item.tag) return item;
      const durations = courseMins.get(item.course) || [];
      const maxMins = durations.length > 1 ? Math.max(...durations) : item.mins;
      if (durations.length > 1 && item.mins < maxMins) {
        return { ...item, tag: '实验考核' };
      }
      return item;
    })
    .sort((a, b) => a.rawStart.getTime() - b.rawStart.getTime());

  if (exams.length === 0) return;

  const firstExam = exams[0];
  const lastExam = exams[exams.length - 1];

  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

  const state: {
    query: string;
    college: string;
    dateFilter: string;
    sort: SortMode;
    view: ViewMode;
  } = {
    query: '',
    college: 'all',
    dateFilter: '',
    sort: 'time',
    view: 'timeline',
  };

  let nextExam: ExamItem | null = null;
  let activeDrawerId: string | null = null;
  let toastTimer: number | null = null;

  const showToast = (msg: string) => {
    const toastEl = byId('hzExamToast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove('is-show');
    }, 2000);
  };

  const copyText = (txt: string, okMsg: string) => {
    const done = () => showToast(okMsg);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(done, fallback);
      return;
    }
    fallback();

    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        showToast('复制失败，请手动选择');
      }
      document.body.removeChild(ta);
    }
  };

  const examClipboardText = (e: ExamItem) =>
    `${e.course}${e.tag ? `（${e.tag}）` : ''}\n` +
    `考试时间：${e.date} ${e.wd} ${e.start}–${e.end}（${e.mins} 分钟）\n` +
    `考试地点：${e.campus} ${e.room}\n` +
    `开课学院：${e.college}（${e.dept}）`;

  const icsStamp = (d: Date) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

  const icsEscape = (s: string) =>
    String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

  const downloadICS = (list: ExamItem[], fname: string) => {
    const nowStamp = icsStamp(new Date());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HORIZON Exam Ephemeris//CN//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(payload.termLabel || '期末考试时间表')}`,
    ];
    list.forEach((e, i) => {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${e.date.replace(/-/g, '')}-${e.start.replace(':', '')}-${i}@blog.acretiondisk.top`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART:${icsStamp(e.rawStart)}`);
      lines.push(`DTEND:${icsStamp(e.rawEnd)}`);
      lines.push(`SUMMARY:${icsEscape(`【考试】${e.course}${e.tag ? `（${e.tag}）` : ''}`)}`);
      lines.push(`LOCATION:${icsEscape(`${e.campus} ${e.room}`)}`);
      lines.push(
        `DESCRIPTION:${icsEscape(`${e.tag ? `考核类型：${e.tag}；` : ''}开课学院：${e.college}；教研室：${e.dept}；时长 ${e.mins} 分钟`)}`,
      );
      lines.push('BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${e.course} 明天开考`)}`, 'END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast(`已导出 ${list.length} 场考试日历 (.ics)`);
  };

  /* ── 倒计时引擎 ─────────────────────────────────────────────────────────── */
  const pickNext = () => {
    const now = new Date();
    nextExam = exams.find((e) => e.rawEnd > now) || null;
  };

  const baselineFor = (now: Date): Date => {
    if (now < firstExam.rawStart) return dayStart(now);
    let prev = firstExam.rawStart;
    for (const e of exams) {
      if (e.rawStart <= now) prev = e.rawEnd;
      else break;
    }
    return prev;
  };

  const setClockUnits = (ms: number) => {
    const safe = Math.max(0, ms);
    const totalSec = Math.floor(safe / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const setUnit = (id: string, val: string) => {
      const el = byId(id);
      if (el && el.textContent !== val) {
        el.textContent = val;
        el.classList.remove('is-ticking');
        void el.offsetWidth;
        el.classList.add('is-ticking');
      }
    };
    setUnit('hzExamD', String(d));
    setUnit('hzExamH', pad2(h));
    setUnit('hzExamM', pad2(m));
    setUnit('hzExamS', pad2(s));
  };

  const paintNextCard = () => {
    const card = byId('hzExamCdCard');
    const courseEl = byId('hzExamCdCourse');
    const dateEl = byId('hzExamCdDate');
    const timeEl = byId('hzExamCdTime');
    const roomEl = byId('hzExamCdRoom');
    const collegeEl = byId('hzExamCdCollege');
    const kindEl = byId('hzExamCdKind');
    const detailBtn = byId<HTMLButtonElement>('hzExamCdDetail');
    const fromEl = byId('hzExamFrom');
    const toEl = byId('hzExamTo');
    if (fromEl) fromEl.textContent = `首场 ${firstExam.date}`;
    if (toEl) toEl.textContent = `末场 ${lastExam.date}`;

    if (!nextExam) {
      if (card) card.setAttribute('data-tone', 'default');
      if (courseEl) courseEl.textContent = '本学期全部考试已结束';
      if (dateEl) dateEl.textContent = `${firstExam.date} — ${lastExam.date}`;
      if (timeEl) timeEl.textContent = `共 ${exams.length} 场`;
      if (roomEl) roomEl.textContent = payload.campus;
      if (collegeEl) collegeEl.textContent = 'ALL CLEARED';
      if (kindEl) kindEl.hidden = true;
      if (detailBtn) detailBtn.hidden = true;
      return;
    }

    if (card) card.setAttribute('data-tone', nextExam.tone);
    if (courseEl) courseEl.textContent = nextExam.course;
    if (dateEl) dateEl.textContent = `${nextExam.date} ${nextExam.wd}`;
    if (timeEl) timeEl.textContent = `${nextExam.start} – ${nextExam.end} (${nextExam.mins} MIN)`;
    if (roomEl) roomEl.textContent = `${nextExam.campus} · ${nextExam.room}`;
    if (collegeEl) collegeEl.textContent = nextExam.college;
    if (kindEl) {
      kindEl.hidden = !nextExam.tag;
      if (nextExam.tag) kindEl.textContent = nextExam.tag;
    }
    if (detailBtn) detailBtn.hidden = false;
  };

  const formatDurationCN = (ms: number) => {
    if (ms <= 0) return '0 秒';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d > 0 ? `${d} 天 ` : ''}${pad2(h)} 时 ${pad2(m)} 分 ${pad2(sec)} 秒`;
  };

  const paintDrawerLive = () => {
    const box = byId('hzExamDrawerCd');
    if (!box || !activeDrawerId) return;
    const e = exams.find((x) => x.id === activeDrawerId);
    if (!e) return;
    const now = new Date();
    if (now > e.rawEnd) {
      box.innerHTML = `本场考试已于 <b>${esc(e.date)} ${esc(e.end)}</b> 结束`;
      return;
    }
    if (now >= e.rawStart) {
      box.innerHTML = `正在进行中 · 距结束还有 <b>${formatDurationCN(e.rawEnd.getTime() - now.getTime())}</b>`;
      return;
    }
    box.innerHTML = `距开考还有 <b>${formatDurationCN(e.rawStart.getTime() - now.getTime())}</b>`;
  };

  const tick = () => {
    const now = new Date();
    if (nextExam && now > nextExam.rawEnd) {
      pickNext();
      paintNextCard();
      render();
    }

    const remainCount = exams.filter((e) => e.rawEnd > now).length;
    const remainEl = byId('hzExamRemainSub');
    if (remainEl) remainEl.textContent = `待考 ${remainCount} 场`;

    const pillEl = byId('hzExamCdPill');
    const barEl = byId('hzExamBar');
    const liveEl = byId('hzExamLiveState');
    const statusBox = byId('hzExamStatusBox');

    if (!nextExam) {
      setClockUnits(0);
      if (pillEl) {
        pillEl.textContent = '已结束';
        pillEl.className = 'hz-exam-badge is-over';
      }
      if (barEl) barEl.style.width = '100%';
      if (liveEl) liveEl.textContent = 'ALL EXAMS COMPLETED';
      if (statusBox) statusBox.classList.remove('is-live');
      paintDrawerLive();
      return;
    }

    const diff = nextExam.rawStart.getTime() - now.getTime();
    const isLive = diff <= 0;
    const base = baselineFor(now);
    const total = Math.max(1, nextExam.rawStart.getTime() - base.getTime());
    const past = Math.min(Math.max(now.getTime() - base.getTime(), 0), total);
    if (barEl) barEl.style.width = `${isLive ? 100 : Math.round((past / total) * 100)}%`;

    if (isLive) {
      setClockUnits(nextExam.rawEnd.getTime() - now.getTime());
      if (pillEl) {
        pillEl.textContent = '正在进行';
        pillEl.className = 'hz-exam-badge is-now';
      }
      if (liveEl) liveEl.textContent = `LIVE // 「${shortCourse(nextExam.course)}」进行中`;
      if (statusBox) statusBox.classList.add('is-live');
    } else {
      setClockUnits(diff);
      const st = examStatus(nextExam, now);
      if (pillEl) {
        pillEl.textContent = st.text;
        pillEl.className = `hz-exam-badge ${st.cls}`.trim();
      }
      if (liveEl) liveEl.textContent = `NEXT // ${shortCourse(nextExam.course)} · ${st.text}`;
      if (statusBox) statusBox.classList.toggle('is-live', st.cls === 'is-now');
    }

    // 同步 22 天条带过去日期状态
    root.querySelectorAll<HTMLElement>('[data-exam-day]').forEach((dayEl) => {
      const dStr = dayEl.dataset.examDay;
      if (!dStr) return;
      const dEnd = parseLocalDateTime(dStr, '23:59');
      dayEl.classList.toggle('is-past', now > dEnd);
    });

    paintDrawerLive();
  };

  /* ── 筛选与排序 ─────────────────────────────────────────────────────────── */
  const getFiltered = (): ExamItem[] => {
    const q = state.query.trim().toLowerCase();
    const list = exams.filter((e) => {
      if (state.college !== 'all' && e.college !== state.college) return false;
      if (state.dateFilter && e.date !== state.dateFilter) return false;
      if (!q) return true;
      const hay = [e.course, e.tag, e.room, e.college, e.dept, e.campus, e.date, e.start, e.end, e.wd]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    const comparators: Record<SortMode, (a: ExamItem, b: ExamItem) => number> = {
      time: (a, b) => a.rawStart.getTime() - b.rawStart.getTime(),
      course: (a, b) => a.course.localeCompare(b.course, 'zh') || a.rawStart.getTime() - b.rawStart.getTime(),
      room: (a, b) => a.room.localeCompare(b.room, 'zh') || a.rawStart.getTime() - b.rawStart.getTime(),
      college: (a, b) => a.college.localeCompare(b.college, 'zh') || a.rawStart.getTime() - b.rawStart.getTime(),
    };

    return list.sort(comparators[state.sort] || comparators.time);
  };

  /* ── 渲染视图 ───────────────────────────────────────────────────────────── */
  const cardHTML = (e: ExamItem, now: Date, idx = 0) => {
    const st = examStatus(e, now);
    const done = now > e.rawEnd;
    return `
      <button
        type="button"
        class="hz-exam-card${done ? ' is-done' : ''}"
        data-exam-id="${e.id}"
        data-tone="${e.tone}"
        style="--i:${Math.min(idx, 16)}"
        aria-label="${esc(e.course)} ${e.date} ${e.start}"
      >
        <div class="hz-exam-card__top">
          <span class="hz-exam-card__college"><i></i><span>${esc(e.college)}</span></span>
          <span class="hz-exam-badge ${st.cls}">${esc(st.text)}</span>
        </div>
        <div class="hz-exam-card__title-row">
          <h3 class="hz-exam-card__title">${esc(e.course)}</h3>
          ${e.tag ? `<span class="hz-exam-kind">${esc(e.tag)}</span>` : ''}
        </div>
        <div class="hz-exam-card__rows">
          <div class="hz-exam-card__row">
            <strong>${esc(e.date)}</strong>
            <span>${esc(e.wd)}</span>
            <span>·</span>
            <strong>${esc(e.start)} – ${esc(e.end)}</strong>
            <span>(${e.mins} MIN)</span>
          </div>
          <div class="hz-exam-card__row">
            <span>${esc(e.campus)}</span>
            <span class="hz-exam-card__room">${esc(e.room)}</span>
          </div>
        </div>
        <div class="hz-exam-card__foot">
          <span>${esc(e.dept)}</span>
          <span class="hz-exam-card__cta">详情 / 日历 →</span>
        </div>
      </button>
    `;
  };

  const renderTimeline = (list: ExamItem[], now: Date) => {
    const groups = new Map<string, ExamItem[]>();
    for (const item of list) {
      const bucket = groups.get(item.date);
      if (bucket) bucket.push(item);
      else groups.set(item.date, [item]);
    }
    const dates = [...groups.keys()].sort((a, b) => parseLocalDate(a).getTime() - parseLocalDate(b).getTime());

    return `<div class="hz-exam-tl">${dates
      .map((dateStr) => {
        const items = (groups.get(dateStr) || []).slice().sort((a, b) => a.rawStart.getTime() - b.rawStart.getTime());
        const d = parseLocalDate(dateStr);
        const st = dayStatus(dateStr, items, now);
        const times = items.map((x) => x.start).join(' / ');
        return `
          <section class="hz-exam-tl-day" data-tone="${items[0]?.tone || 'default'}">
            <div class="hz-exam-tl-rail">
              <span class="hz-exam-tl-node" aria-hidden="true"></span>
              <span class="hz-exam-tl-date">${d.getMonth() + 1}/${pad2(d.getDate())}</span>
              <span class="hz-exam-tl-sub">${d.getFullYear()} · ${esc(items[0]?.wd || '')}</span>
            </div>
            <div class="hz-exam-tl-body">
              <div class="hz-exam-tl-head">
                <b>${fmtDateCN(d)} ${esc(items[0]?.wd || '')}</b>
                <span class="hz-mono">${items.length} 场 · ${esc(times)} 开考</span>
                <span class="hz-exam-badge ${st.cls}">${esc(st.text)}</span>
              </div>
              <div class="hz-exam-tl-cards">${items.map((item, idx) => cardHTML(item, now, idx)).join('')}</div>
            </div>
          </section>
        `;
      })
      .join('')}</div>`;
  };

  const renderGrid = (list: ExamItem[], now: Date) =>
    `<div class="hz-exam-grid">${list.map((e, idx) => cardHTML(e, now, idx)).join('')}</div>`;

  const renderTable = (list: ExamItem[], now: Date) => `
    <div class="hz-exam-table-wrap">
      <table class="hz-exam-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>星期</th>
            <th>课程名称</th>
            <th>考试时间</th>
            <th>时长</th>
            <th>考场</th>
            <th>校区</th>
            <th>开课学院</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((e) => {
              const st = examStatus(e, now);
              const done = now > e.rawEnd;
              return `
                <tr class="${done ? 'is-done' : ''}" data-exam-id="${e.id}" data-tone="${e.tone}" tabindex="0" role="button">
                  <td class="hz-exam-table__mono">${esc(e.date)}</td>
                  <td>${esc(e.wd)}</td>
                  <td class="hz-exam-table__course">${esc(e.course)}${e.tag ? ` <span class="hz-exam-kind">${esc(e.tag)}</span>` : ''}</td>
                  <td class="hz-exam-table__mono">${esc(e.start)} – ${esc(e.end)}</td>
                  <td class="hz-exam-table__mono">${e.mins}m</td>
                  <td class="hz-exam-table__mono">${esc(e.room)}</td>
                  <td>${esc(e.campus)}</td>
                  <td><span class="hz-exam-table__college"><i></i>${esc(e.college)}</span></td>
                  <td><span class="hz-exam-badge ${st.cls}">${esc(st.text)}</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  const render = () => {
    const viewEl = byId('hzExamView');
    const emptyEl = byId('hzExamEmpty');
    const countEl = byId('hzExamShown');
    const clearDateBtn = byId<HTMLButtonElement>('hzExamClearDate');
    if (!viewEl) return;

    const list = getFiltered();
    const now = new Date();

    if (countEl) countEl.textContent = String(list.length);

    if (clearDateBtn) {
      if (state.dateFilter) {
        clearDateBtn.hidden = false;
        clearDateBtn.textContent = `已筛选 ${state.dateFilter} · 清除`;
      } else {
        clearDateBtn.hidden = true;
      }
    }

    root.querySelectorAll<HTMLElement>('[data-exam-day]').forEach((el) => {
      el.classList.toggle('is-selected', Boolean(state.dateFilter && el.dataset.examDay === state.dateFilter));
    });

    root.querySelectorAll<HTMLButtonElement>('[data-exam-view]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.examView === state.view));
    });

    if (list.length === 0) {
      viewEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    viewEl.innerHTML =
      state.view === 'grid'
        ? renderGrid(list, now)
        : state.view === 'table'
          ? renderTable(list, now)
          : renderTimeline(list, now);
    replayEnter(viewEl);
  };

  /* ── 详情抽屉 ───────────────────────────────────────────────────────────── */
  let drawerTrigger: HTMLElement | null = null;
  const openDrawer = (id: string) => {
    const e = exams.find((x) => x.id === id);
    const drawer = byId('hzExamDrawer');
    if (!e || !drawer) return;

    drawerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeDrawerId = id;
    const now = new Date();
    const st = examStatus(e, now);
    const diffDays = daysBetween(now, parseLocalDate(e.date));
    const dayRel = diffDays > 0 ? `${diffDays} 天后` : diffDays === 0 ? '就在今天' : `已过 ${-diffDays} 天`;

    drawer.setAttribute('data-tone', e.tone);
    drawer.setAttribute('aria-hidden', 'false');

    const titleEl = byId('hzExamDrawerTitle');
    const subEl = byId('hzExamDrawerSub');
    const kindEl = byId('hzExamDrawerKind');
    const badgeEl = byId('hzExamDrawerBadge');
    const listEl = byId('hzExamDrawerList');

    if (titleEl) titleEl.textContent = e.course;
    if (subEl) subEl.textContent = `${e.year} 学年 · 第 ${e.term} 学期 · ${e.campus}`;
    if (kindEl) {
      kindEl.hidden = !e.tag;
      if (e.tag) kindEl.textContent = e.tag;
    }
    if (badgeEl) {
      badgeEl.textContent = st.text;
      badgeEl.className = `hz-exam-badge ${st.cls}`.trim();
    }
    if (listEl) {
      const rows: [string, string][] = [
        ['考试日期', `${e.date} ${e.wd}`],
        ['考试时间', `${e.start} – ${e.end}（${e.mins} 分钟）`],
        ['考试地点', `${e.campus} · ${e.room}`],
        ...(e.tag ? ([['考核性质', e.tag]] as [string, string][]) : []),
        ['开课学院', e.college],
        ['教研室', e.dept],
        ['距考天数', dayRel],
      ];
      listEl.innerHTML = rows
        .map(
          ([k, v]) =>
            `<div class="hz-drawer__row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
        )
        .join('');
    }

    paintDrawerLive();
    document.body.classList.add('hz-drawer-open');
    byId<HTMLButtonElement>('hzExamDrawerClose')?.focus();
  };

  const closeDrawer = () => {
    const drawer = byId('hzExamDrawer');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('hz-drawer-open');
    activeDrawerId = null;
    if (drawerTrigger && drawerTrigger.isConnected) drawerTrigger.focus({ preventScroll: true });
    drawerTrigger = null;
  };

  /* ── 事件绑定 ───────────────────────────────────────────────────────────── */
  const searchInput = byId<HTMLInputElement>('hzExamSearch');
  searchInput?.addEventListener('input', () => {
    state.query = searchInput.value;
    render();
  });

  const sortSelect = byId<HTMLSelectElement>('hzExamSort');
  sortSelect?.addEventListener('change', () => {
    const val = sortSelect.value as SortMode;
    state.sort = ['time', 'course', 'room', 'college'].includes(val) ? val : 'time';
    render();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-exam-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.examView as ViewMode;
      if (v === 'timeline' || v === 'grid' || v === 'table') {
        state.view = v;
        render();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-exam-college]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.college = btn.dataset.examCollege || 'all';
      root.querySelectorAll<HTMLButtonElement>('[data-exam-college]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-exam-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dateStr = btn.dataset.examDay || '';
      if (!dateStr) return;
      state.dateFilter = state.dateFilter === dateStr ? '' : dateStr;
      render();
    });
  });

  byId('hzExamClearDate')?.addEventListener('click', () => {
    state.dateFilter = '';
    render();
  });

  byId('hzExamReset')?.addEventListener('click', () => {
    state.query = '';
    state.college = 'all';
    state.dateFilter = '';
    if (searchInput) searchInput.value = '';
    root.querySelectorAll<HTMLButtonElement>('[data-exam-college]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.examCollege === 'all'));
    });
    render();
  });

  const viewEl = byId('hzExamView');
  viewEl?.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-exam-id]');
    if (target?.dataset.examId) openDrawer(target.dataset.examId);
  });
  viewEl?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-exam-id]');
    if (target?.dataset.examId) {
      ev.preventDefault();
      openDrawer(target.dataset.examId);
    }
  });

  byId('hzExamCdDetail')?.addEventListener('click', () => {
    if (nextExam) openDrawer(nextExam.id);
  });

  byId('hzExamExportAll')?.addEventListener('click', () => {
    downloadICS(exams, '期末考试时间表-2026-2027-1.ics');
  });

  byId('hzExamPrint')?.addEventListener('click', () => {
    window.print();
  });

  byId('hzExamDrawerClose')?.addEventListener('click', closeDrawer);
  byId('hzExamDrawerBackdrop')?.addEventListener('click', closeDrawer);

  byId('hzExamDrawerCopy')?.addEventListener('click', () => {
    const e = exams.find((x) => x.id === activeDrawerId);
    if (e) copyText(examClipboardText(e), `已复制：${e.course}`);
  });

  byId('hzExamDrawerIcs')?.addEventListener('click', () => {
    const e = exams.find((x) => x.id === activeDrawerId);
    if (e) downloadICS([e], `${e.course}-${e.date}.ics`);
  });

  document.addEventListener('keydown', (ev) => {
    const active = document.activeElement as HTMLElement | null;
    const activeTag = active?.tagName || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(activeTag) || Boolean(active?.isContentEditable);
    if (ev.key === 'Escape') {
      if (activeDrawerId) closeDrawer();
      else if (active === searchInput && searchInput) {
        if (searchInput.value) {
          searchInput.value = '';
          state.query = '';
          render();
        } else {
          searchInput.blur();
        }
      } else if (typing && active) {
        active.blur();
      }
      return;
    }
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '/') {
      ev.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (ev.key === '1') {
      state.view = 'timeline';
      render();
    } else if (ev.key === '2') {
      state.view = 'grid';
      render();
    } else if (ev.key === '3') {
      state.view = 'table';
      render();
    }
  });

  /* ── 启动 ───────────────────────────────────────────────────────────────── */
  pickNext();
  paintNextCard();
  render();

  let tickTimer = 0;
  const startTick = () => {
    tick();
    if (!tickTimer && !document.hidden) {
      tickTimer = window.setInterval(tick, 1000);
    }
  };
  const stopTick = () => {
    if (tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = 0;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTick();
    else startTick();
  });
  startTick();
}

initExamPage();
