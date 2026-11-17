import {
  DAY_NAMES,
  DEFAULT_SLOT_HEIGHT,
  addDays,
  clampSlotHeight,
  courseIdentity,
  courseLayer,
  displayRoom,
  eventDisplayTitle,
  eventEndMinute,
  eventInWeek,
  eventStartMinute,
  favoriteKey,
  formatClock,
  formatFull,
  formatMD,
  mondayOf,
  pad2,
  roomDisplayParts,
  timeLabel,
  timeToMinutes,
  toIso,
  validMonth,
  weeksLabel,
  type AnyScheduleEvent,
  type SchedulePayload,
  type TimetableData,
} from '../../lib/schedule-core.mjs';

const VISITOR_PREFS_KEY = 'hz-schedule-visitor-v1';

type ViewMode = 'schedule' | 'month' | 'list' | 'favorites';

interface VisitorPrefs {
  activeId?: string | null;
  favorites?: string[];
  hideEmptyWeekends?: boolean;
  view?: ViewMode;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));

const truncateTitle = (title: string) => (title.length > 11 ? `${title.slice(0, 11)}…` : title);

function initSchedulePage() {
  const root = document.querySelector<HTMLElement>('[data-sched-root]');
  if (!root) return;
  const dataEl = document.querySelector<HTMLScriptElement>('script[data-sched-data]');
  if (!dataEl?.textContent) return;

  let payload: SchedulePayload;
  try {
    payload = JSON.parse(dataEl.textContent) as SchedulePayload;
  } catch {
    return;
  }

  const timetables: TimetableData[] = Array.isArray(payload.timetables) ? payload.timetables : [];

  const loadVisitorPrefs = (): VisitorPrefs => {
    try {
      const raw = localStorage.getItem(VISITOR_PREFS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as VisitorPrefs;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const prefs = loadVisitorPrefs();
  const initialActiveId = timetables.some((t) => t.id === prefs.activeId)
    ? (prefs.activeId ?? null)
    : (timetables.some((t) => t.id === payload.activeId) ? payload.activeId : (timetables[0]?.id ?? null));

  const state = {
    timetables,
    activeId: initialActiveId,
    favorites: Array.isArray(prefs.favorites)
      ? prefs.favorites
      : (Array.isArray(payload.favorites) ? [...payload.favorites] : []),
    hideEmptyWeekends: typeof prefs.hideEmptyWeekends === 'boolean'
      ? prefs.hideEmptyWeekends
      : Boolean(payload.hideEmptyWeekends),
    slotHeight: clampSlotHeight(payload.slotHeight ?? DEFAULT_SLOT_HEIGHT),
    view: (['schedule', 'month', 'list', 'favorites'].includes(String(prefs.view)) ? prefs.view : 'schedule') as ViewMode,
    week: 1,
    day: 1,
    month: '',
    query: '',
  };

  const saveVisitorPrefs = () => {
    try {
      localStorage.setItem(VISITOR_PREFS_KEY, JSON.stringify({
        activeId: state.activeId,
        favorites: state.favorites,
        hideEmptyWeekends: state.hideEmptyWeekends,
        view: state.view,
      }));
    } catch {
      /* ignore storage errors */
    }
  };

  root.style.setProperty('--slot-h', `${state.slotHeight}px`);

  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const currentTimetable = () => state.timetables.find((t) => t.id === state.activeId) || null;
  const currentEvents = (): AnyScheduleEvent[] => {
    const tt = currentTimetable();
    return tt ? [...(tt.events || []), ...(tt.customEvents || [])] : [];
  };
  const currentTermStart = () => currentTimetable()?.termStartDate || toIso(mondayOf(new Date()));
  const termMonday = () => mondayOf(new Date(`${currentTermStart()}T00:00:00`));

  const dayInfo = (week: number) => {
    const monday = addDays(termMonday(), (week - 1) * 7);
    return DAY_NAMES.map((name, index) => {
      const fullDate = addDays(monday, index);
      return { key: index + 1, name, date: formatMD(fullDate), fullDate };
    });
  };

  const weekAndDayForDate = (date: Date) => {
    const diff = Math.round((mondayOf(date).getTime() - termMonday().getTime()) / 86400000);
    return { week: Math.floor(diff / 7) + 1, day: (date.getDay() + 6) % 7 + 1 };
  };

  const maxWeek = () => Math.max(1, ...currentEvents().flatMap((ev) => (ev.weeks || []).map((r) => r.end)));
  const currentWeekInfo = () => weekAndDayForDate(new Date());
  const minNavigableWeek = () => Math.min(1, currentWeekInfo().week);
  const maxNavigableWeek = () => Math.max(maxWeek(), currentWeekInfo().week);
  const clampNavigableWeek = (week: number) => Math.min(maxNavigableWeek(), Math.max(minNavigableWeek(), Math.trunc(week || 1)));

  const weekLabel = (week: number) => {
    if (week < 1) return `开学前第 ${1 - week} 周`;
    const max = maxWeek();
    if (week > max) return `放假后第 ${week - max} 周`;
    return `第 ${week} 周`;
  };

  const monthCursor = () => {
    if (validMonth(state.month)) return new Date(`${state.month}-01T00:00:00`);
    const today = new Date();
    state.month = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
    return new Date(`${state.month}-01T00:00:00`);
  };
  const monthLabel = (date = monthCursor()) => `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
  const monthBounds = (date = monthCursor()) => ({
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  });
  const shiftMonth = (delta: number) => {
    const date = monthCursor();
    date.setMonth(date.getMonth() + delta, 1);
    state.month = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  };

  // 默认定位到当前所在周次与当天
  const initNow = currentWeekInfo();
  state.week = clampNavigableWeek(initNow.week);
  state.day = initNow.day;
  monthCursor();

  const isFavoriteEvent = (event: AnyScheduleEvent) => {
    const key = favoriteKey(event, currentTimetable()?.id || '');
    return Boolean(key && state.favorites.includes(key));
  };

  const visibleEventsForWeek = (week: number) => {
    const tt = currentTimetable();
    let events = currentEvents().filter((ev) => !ev.hidden);
    if (state.view === 'favorites') events = events.filter((ev) => ev.kind !== 'custom' && isFavoriteEvent(ev));
    if (state.query) {
      const q = state.query.toLowerCase();
      events = events.filter((ev) => {
        const extra = ev.kind === 'custom'
          ? `${ev.description || ''}`
          : `${ev.courseCode || ''} ${ev.className || ''} ${ev.note || ''} ${ev.assessment || ''} ${ev.teacher || ''} ${ev.campus || ''}`;
        return `${ev.title} ${eventDisplayTitle(ev, week, tt)} ${ev.room || ''} ${extra}`.toLowerCase().includes(q);
      });
    }
    if (state.view !== 'favorites') events = events.filter((ev) => eventInWeek(ev, week));
    return events;
  };

  const roomMarkup = (event: AnyScheduleEvent) => {
    const parts = roomDisplayParts(event);
    return parts.code
      ? `<span class="hz-course-room-code" data-room-code-length="${parts.code.length}">${escapeHtml(parts.code)}</span>${parts.extra ? `<span class="hz-course-room-extra">${escapeHtml(parts.extra)}</span>` : ''}`
      : `<span class="hz-course-room-free">${escapeHtml(parts.room)}</span>`;
  };

  let scheduleAxis = { start: 8 * 60, end: 8 * 60 + 45, pxPerMinute: state.slotHeight / 45 };
  let activeEvent: AnyScheduleEvent | null = null;
  let activeEventWeek = state.week;
  let swipeAnimationFrame = 0;
  let swipePosition = 0;
  let swipeState: {
    id: number;
    startX: number;
    startY: number;
    origin: number;
    velocity: number;
    samples: { x: number; time: number }[];
    horizontal: boolean;
    cancelled: boolean;
  } | null = null;

  const buildScheduleMarkup = (week: number, interactive = true) => {
    const tt = currentTimetable();
    const allDays = dayInfo(week);
    const events = visibleEventsForWeek(week);
    const weekEvents = currentEvents().filter((ev) => !ev.hidden && eventInWeek(ev, week));
    const days = state.hideEmptyWeekends
      ? allDays.filter((day) => day.key <= 5 || weekEvents.some((ev) => ev.day === day.key))
      : allDays;
    const slotHeight = Number.parseFloat(getComputedStyle(root).getPropertyValue('--slot-h')) || state.slotHeight;
    const pxPerMinute = slotHeight / 45;
    const now = new Date();
    const current = weekAndDayForDate(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const isCurrentWeek = week === current.week;
    const todayKey = isCurrentWeek ? current.day : null;
    const customStarts = events
      .filter((ev) => ev.kind === 'custom')
      .map(eventStartMinute)
      .filter((n): n is number => Number.isFinite(n));
    const axisStart = customStarts.length ? Math.min(8 * 60, Math.floor(Math.min(...customStarts) / 45) * 45) : 8 * 60;
    const nowAbsolute = isCurrentWeek && nowMinutes < axisStart ? nowMinutes + 1440 : nowMinutes;
    const endMinutes = events.map(eventEndMinute).filter((n): n is number => Number.isFinite(n));
    const lastEnd = endMinutes.length ? Math.max(...endMinutes) : axisStart + 45;
    const latestEnd = isCurrentWeek ? Math.max(lastEnd, nowAbsolute) : lastEnd;
    const axisEnd = Math.ceil(Math.max(axisStart + 45, latestEnd) / 45) * 45;
    const totalHeight = Math.round((axisEnd - axisStart) * pxPerMinute);
    const ticks: number[] = [];
    for (let m = axisStart; m < axisEnd; m += 45) ticks.push(m);
    const showNowLine = isCurrentWeek && nowAbsolute >= axisStart && nowAbsolute <= axisEnd;
    const nowLine = showNowLine
      ? `<div class="hz-now-line"${interactive ? ' id="hzNowLine"' : ''} style="top:${Math.round((nowAbsolute - axisStart) * pxPerMinute)}px"><span class="hz-now-label">${formatClock(nowAbsolute)}</span></div>`
      : '';

    const head = `<div class="hz-sched-grid__head"><div class="hz-head-cell"><span>TIME</span></div>${days
      .map((day) => `<div class="hz-head-cell ${state.day === day.key ? 'focus' : ''} ${day.key === todayKey ? 'today-column' : ''}"><span class="hz-head-day"><b>${day.name}</b><small class="hz-head-date">${day.date}</small></span></div>`)
      .join('')}</div>`;
    const axis = `<div class="hz-time-axis" style="height:${totalHeight}px">${ticks
      .map((m) => `<div class="hz-time-tick" style="height:${Math.round(45 * pxPerMinute)}px">${formatClock(m)}</div>`)
      .join('')}</div>`;

    const allEvents = currentEvents();
    const columns = days
      .map((day) => `<div class="hz-day-col ${day.key === todayKey ? 'today-column' : ''}" style="height:${totalHeight}px">${events
        .filter((ev) => ev.day === day.key)
        .map((ev) => {
          const startMin = eventStartMinute(ev) ?? axisStart;
          const endMin = eventEndMinute(ev) ?? startMin + 40;
          const top = Math.round((startMin - axisStart) * pxPerMinute);
          const duration = endMin - startMin;
          const height = ev.kind === 'custom' ? Math.max(28, Math.round(duration * pxPerMinute)) : Math.round(duration * pxPerMinute);
          const density = height < 108 ? ' course-tiny' : height < 166 ? ' course-compact' : '';
          const ultraShort = duration < 40;
          const fortyMin = duration === 40;
          const ongoing = isCurrentWeek && ev.day === todayKey && nowAbsolute >= startMin && nowAbsolute < endMin;
          const displayTitle = eventDisplayTitle(ev, week, tt);
          const colorAttr = ev.kind === 'custom' ? ev.color : ev.cardColor;
          const colorPart = colorAttr ? ` data-color="${escapeHtml(colorAttr)}"` : '';
          const tag = interactive ? 'button' : 'div';
          const attrs = interactive ? ` data-sched-event="${allEvents.indexOf(ev)}" data-sched-week="${week}" type="button"` : '';
          const details = ev.kind === 'custom'
            ? ultraShort
              ? `<span class="hz-course-title">${escapeHtml(truncateTitle(displayTitle))}</span>`
              : `<span class="hz-course-title">${escapeHtml(truncateTitle(displayTitle))}</span><span class="hz-course-time">${timeLabel(ev)}</span><span class="hz-course-room">${roomMarkup(ev)}</span>${ev.description ? `<span class="hz-course-desc">${escapeHtml(ev.description)}</span>` : ''}`
            : ultraShort
              ? `<span class="hz-course-title">${escapeHtml(truncateTitle(displayTitle))}</span>`
              : fortyMin
                ? `<span class="hz-course-title">${escapeHtml(truncateTitle(displayTitle))}</span><span class="hz-course-room">${roomMarkup(ev)}</span>`
                : `<span class="hz-course-title">${escapeHtml(truncateTitle(displayTitle))}</span><span class="hz-course-time">${timeLabel(ev)}</span><span class="hz-course-room">${roomMarkup(ev)}</span><span class="hz-course-meta">${escapeHtml(ev.campus)} · ${escapeHtml(ev.teacher)}</span>`;
          const showType = ev.kind === 'custom' ? !ultraShort && duration >= 60 : !ultraShort && !fortyMin;
          return `<${tag} class="hz-course type-${escapeHtml(ev.type)} layer-${courseLayer(ev)}${density}${ultraShort ? ' course-ultra-short' : ''}${ongoing ? ' ongoing' : ''}"${colorPart}${attrs} style="top:${top}px;height:${height}px" title="${escapeHtml(displayTitle)}"><span class="hz-course-content">${details}${showType ? `<span class="hz-course-type">${escapeHtml(ev.label)}</span>` : ''}</span></${tag}>`;
        })
        .join('')}</div>`)
      .join('');

    return {
      html: `${head}<div class="hz-sched-grid__body">${axis}${columns}${nowLine}</div>`,
      events,
      dayCount: days.length,
      axis: { start: axisStart, end: axisEnd, pxPerMinute },
    };
  };

  const agendaMarkup = (week: number, interactive = true) => {
    const tt = currentTimetable();
    const days = dayInfo(week);
    const events = visibleEventsForWeek(week);
    const allEvents = currentEvents();
    const isFavorites = state.view === 'favorites';

    const sections = days
      .filter((day) => events.some((ev) => ev.day === day.key))
      .map((day) => {
        const dayEvents = events
          .filter((ev) => ev.day === day.key)
          .sort((a, b) => (eventStartMinute(a) ?? 0) - (eventStartMinute(b) ?? 0));
        return `<section class="hz-agenda-day"><div class="hz-agenda-day__head"><b>${isFavorites ? day.name : `${day.name} · ${day.date}`}</b><span class="hz-mono">${dayEvents.length} 节</span></div><div class="hz-agenda-list">${dayEvents
          .map((ev) => {
            const tag = interactive ? 'button' : 'div';
            const attrs = interactive ? ` data-sched-event="${allEvents.indexOf(ev)}" data-sched-week="${week}" type="button"` : '';
            const colorAttr = ev.kind === 'custom' ? ev.color : ev.cardColor;
            const colorPart = colorAttr ? ` data-color="${escapeHtml(colorAttr)}"` : '';
            const displayTitle = eventDisplayTitle(ev, week, tt);
            const meta = ev.kind === 'custom'
              ? `${escapeHtml(displayRoom(ev))}${ev.description ? ' · ' + escapeHtml(ev.description) : ''}`
              : `${escapeHtml(ev.campus)} · ${escapeHtml(displayRoom(ev))} · ${escapeHtml(ev.teacher)}${isFavorites ? ' · ' + escapeHtml(weeksLabel(ev.weeks)) : ''}`;
            return `<${tag} class="hz-agenda-ev type-${escapeHtml(ev.type)}"${colorPart}${attrs}><span class="hz-agenda-ev__time">${timeLabel(ev)}</span><span class="hz-agenda-ev__main"><span class="hz-agenda-ev__title">${escapeHtml(displayTitle)}</span><span class="hz-agenda-ev__meta">${meta}</span></span><span class="hz-agenda-ev__badge">${escapeHtml(ev.label)}</span></${tag}>`;
          })
          .join('')}</div></section>`;
      })
      .join('');

    if (sections) return sections;
    const searching = Boolean(state.query.trim());
    const msg = isFavorites
      ? '尚未收藏任何课程（点击课表卡片右上角书签即可收藏）。'
      : searching
        ? '没有找到匹配的课程或日程。'
        : '当前周次没有安排课程。';
    return `<div class="hz-empty"><p class="hz-mono">NO RECORDS</p><p>${msg}</p>${searching ? '<button type="button" class="hz-btn" data-sched-clear>清除搜索</button>' : ''}</div>`;
  };

  const monthEventsForDate = (date: Date) => {
    const target = weekAndDayForDate(date);
    return visibleEventsForWeek(target.week)
      .filter((ev) => ev.day === target.day)
      .sort((a, b) => (eventStartMinute(a) ?? 0) - (eventStartMinute(b) ?? 0));
  };

  const monthEventCount = () => {
    const { start, end } = monthBounds();
    let count = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) count += monthEventsForDate(d).length;
    return count;
  };

  const monthMarkup = (interactive = true, preview = false, monthValue = '') => {
    const tt = currentTimetable();
    const cursor = validMonth(monthValue) ? new Date(`${monthValue}-01T00:00:00`) : monthCursor();
    const { start, end } = monthBounds(cursor);
    const offset = (start.getDay() + 6) % 7;
    const totalDays = end.getDate();
    const rowCount = Math.ceil((offset + totalDays) / 7);
    const todayIso = toIso(new Date());
    const allEvents = currentEvents();

    const weekdays = DAY_NAMES.map((name) => `<div class="hz-month__weekday">${name}</div>`).join('');
    const rows = Array.from({ length: rowCount }, (_, rowIdx) => {
      const cells = Array.from({ length: 7 }, (_, colIdx) => {
        const dayNum = rowIdx * 7 + colIdx - offset + 1;
        if (dayNum < 1 || dayNum > totalDays) {
          return '<div class="hz-month__cell" aria-hidden="true"></div>';
        }
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNum);
        const iso = toIso(date);
        const target = weekAndDayForDate(date);
        const events = monthEventsForDate(date);
        const limit = preview ? 3 : 5;
        const eventHtml = events.slice(0, limit).map((ev) => {
          const tag = interactive ? 'button' : 'div';
          const attrs = interactive ? ` data-sched-event="${allEvents.indexOf(ev)}" data-sched-week="${target.week}" type="button"` : '';
          const colorAttr = ev.kind === 'custom' ? ev.color : ev.cardColor;
          const colorPart = colorAttr ? ` data-color="${escapeHtml(colorAttr)}"` : '';
          const title = eventDisplayTitle(ev, target.week, tt);
          return `<${tag} class="hz-month-ev type-${escapeHtml(ev.type)}"${colorPart}${attrs} title="${escapeHtml(title)}"><span class="hz-month-ev__time">${escapeHtml(timeLabel(ev).split('–')[0])}</span><span class="hz-month-ev__title">${escapeHtml(truncateTitle(title))}</span></${tag}>`;
        }).join('');
        const more = events.length > limit ? `<div class="hz-month-more">+${events.length - limit}</div>` : '';
        const classes = ['hz-month__cell', iso === todayIso ? 'today' : '', target.week === state.week ? 'week-focus' : ''].filter(Boolean).join(' ');
        return `<div class="${classes}"><div class="hz-month__date"><span>${dayNum}</span><small>${events.length ? `${events.length}节` : ''}</small></div><div class="hz-month__events">${eventHtml}${more}</div></div>`;
      }).join('');
      return `<div class="hz-month__week">${cells}</div>`;
    }).join('');
    return `<div class="hz-month__weekdays">${weekdays}</div>${rows}`;
  };

  const nextCourseToday = () => {
    const tt = currentTimetable();
    if (!tt) return { label: 'TODAY', value: '尚未配置课表' };
    const today = currentWeekInfo();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayEvents = currentEvents()
      .filter((ev) => !ev.hidden && ev.day === today.day && eventInWeek(ev, today.week))
      .sort((a, b) => (eventStartMinute(a) ?? 0) - (eventStartMinute(b) ?? 0));
    const prefix = `今天 ${DAY_NAMES[today.day - 1]}`;
    if (!todayEvents.length) return { label: `${prefix} · 无课`, value: '今日无课程安排' };
    const ongoing = todayEvents.find((ev) => {
      const s = eventStartMinute(ev) ?? 0;
      const e = eventEndMinute(ev) ?? 0;
      return nowMinutes >= s && nowMinutes < e;
    });
    if (ongoing) {
      return {
        label: `${prefix} · 进行中`,
        value: `${eventDisplayTitle(ongoing, today.week, tt)} · ${displayRoom(ongoing)}`,
      };
    }
    const next = todayEvents.find((ev) => timeToMinutes(timeLabel(ev).split('–')[0]) > nowMinutes);
    if (next) {
      return {
        label: `${prefix} · 下一节 ${timeLabel(next).split('–')[0]}`,
        value: `${eventDisplayTitle(next, today.week, tt)} · ${displayRoom(next)}`,
      };
    }
    const last = todayEvents[todayEvents.length - 1];
    return {
      label: `${prefix} · 已结束`,
      value: `${eventDisplayTitle(last, today.week, tt)} 已下课`,
    };
  };

  const todayButtonLabel = () => {
    const w = currentWeekInfo().week;
    if (w < 1) return '回到第一周';
    if (w > maxWeek()) return '回到最后一周';
    return '回到今天';
  };

  const todayEyebrowLabel = () => {
    const { week, day } = currentWeekInfo();
    if (week >= 1 && week <= maxWeek()) return `第 ${week} 周 · ${DAY_NAMES[day - 1]}`;
    return weekLabel(week);
  };

  const setSwipeTransform = (value: number) => {
    const surface = byId('hzSwipeSurface');
    swipePosition = Math.round(value * 100) / 100;
    if (surface) surface.style.transform = `translate3d(calc(-100% + ${swipePosition}px), 0, 0)`;
  };
  const stopSwipeAnimation = () => {
    if (swipeAnimationFrame) cancelAnimationFrame(swipeAnimationFrame);
    swipeAnimationFrame = 0;
  };
  const animateSwipeTo = (target: number, initialVelocity = 0, done?: () => void) => {
    stopSwipeAnimation();
    const surface = byId('hzSwipeSurface');
    if (!surface || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSwipeTransform(target);
      done?.();
      return;
    }
    let pos = swipePosition;
    let vel = initialVelocity;
    let prev = performance.now();
    const step = (ts: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (ts - prev) / 1000));
      prev = ts;
      const spring = 420 * (target - pos);
      const damp = 38 * vel;
      vel += (spring - damp) * dt;
      pos += vel * dt;
      setSwipeTransform(pos);
      if (Math.abs(target - pos) < 0.45 && Math.abs(vel) < 8) {
        setSwipeTransform(target);
        swipeAnimationFrame = 0;
        done?.();
        return;
      }
      swipeAnimationFrame = requestAnimationFrame(step);
    };
    swipeAnimationFrame = requestAnimationFrame(step);
  };

  const openDrawer = (event: AnyScheduleEvent, week = state.week) => {
    if (!event) return;
    activeEvent = event;
    activeEventWeek = week;
    const tt = currentTimetable();
    const displayTitle = eventDisplayTitle(event, week, tt);
    const hasAlias = event.kind !== 'custom' && displayTitle !== event.title;
    const kicker = byId('hzDrawerKicker');
    const title = byId('hzDrawerTitle');
    const origin = byId('hzDrawerOrigin');
    const sub = byId('hzDrawerSub');
    if (kicker) kicker.textContent = `${event.type.toUpperCase()} // ${event.label}`;
    if (title) title.textContent = displayTitle;
    if (origin) {
      origin.hidden = !hasAlias;
      origin.textContent = hasAlias ? `原课程名：${event.title}` : '';
    }
    if (sub) {
      sub.textContent = event.kind === 'custom'
        ? `第 ${event.week} 周 · ${DAY_NAMES[event.day - 1]}`
        : `${DAY_NAMES[event.day - 1]} · 第 ${event.start}–${event.end} 节`;
    }
    const setRow = (rowId: string, valId: string, val: string, show = true) => {
      const row = byId(rowId);
      const el = byId(valId);
      if (row) row.hidden = !show;
      if (el) el.textContent = val || '—';
    };
    setRow('hzRowTime', 'hzDetailTime', timeLabel(event), true);
    setRow(
      'hzRowRoom',
      'hzDetailRoom',
      event.kind === 'custom' ? displayRoom(event) : `${event.campus} · ${displayRoom(event)}`,
      true,
    );
    setRow('hzRowDesc', 'hzDetailDesc', event.kind === 'custom' ? event.description : '', event.kind === 'custom' && Boolean(event.description));
    setRow('hzRowTeacher', 'hzDetailTeacher', event.kind === 'custom' ? '' : event.teacher, event.kind !== 'custom');
    setRow('hzRowWeeks', 'hzDetailWeeks', weeksLabel(event.weeks), true);
    setRow('hzRowType', 'hzDetailType', event.label, true);
    setRow('hzRowCredit', 'hzDetailCredit', event.kind === 'custom' ? '' : String(event.credit || '—'), event.kind !== 'custom');
    setRow('hzRowCode', 'hzDetailCode', event.kind === 'custom' ? '' : (event.courseCode || ''), event.kind !== 'custom' && Boolean(event.courseCode));
    setRow('hzRowAssessment', 'hzDetailAssessment', event.kind === 'custom' ? '' : (event.assessment || ''), event.kind !== 'custom' && Boolean(event.assessment));
    setRow('hzRowNote', 'hzDetailNote', event.kind === 'custom' ? '' : (event.note || ''), event.kind !== 'custom' && Boolean(event.note));

    const favBtn = byId<HTMLButtonElement>('hzDrawerFav');
    if (favBtn) {
      const isCustom = event.kind === 'custom';
      favBtn.hidden = isCustom;
      const fav = !isCustom && isFavoriteEvent(event);
      favBtn.setAttribute('aria-pressed', String(fav));
      favBtn.textContent = fav ? '★ 已收藏' : '☆ 收藏';
    }

    document.body.classList.add('hz-drawer-open');
    const drawer = byId('hzDrawer');
    if (drawer) drawer.setAttribute('aria-hidden', 'false');
  };

  const closeDrawer = () => {
    document.body.classList.remove('hz-drawer-open');
    const drawer = byId('hzDrawer');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
  };

  const bindEventTriggers = (scope: Document | HTMLElement = document) => {
    scope.querySelectorAll<HTMLElement>('[data-sched-event]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.schedEvent);
        const w = Number(btn.dataset.schedWeek || state.week);
        const ev = currentEvents()[idx];
        if (ev) openDrawer(ev, w);
      });
    });
    scope.querySelectorAll<HTMLElement>('[data-sched-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.query = '';
        const input = byId<HTMLInputElement>('hzSchedSearch');
        if (input) input.value = '';
        renderAll();
      });
    });
  };

  const renderPreviews = () => {
    const prevEl = byId('hzPrevPreview');
    const nextEl = byId('hzNextPreview');
    if (!prevEl || !nextEl) return;
    if (!state.timetables.length) {
      prevEl.innerHTML = '';
      nextEl.innerHTML = '';
      return;
    }
    if (state.view === 'month') {
      const prevCursor = monthCursor();
      prevCursor.setMonth(prevCursor.getMonth() - 1, 1);
      const nextCursor = monthCursor();
      nextCursor.setMonth(nextCursor.getMonth() + 1, 1);
      prevEl.innerHTML = `<section class="hz-month preview-month" aria-hidden="true">${monthMarkup(false, true, `${prevCursor.getFullYear()}-${pad2(prevCursor.getMonth() + 1)}`)}</section>`;
      nextEl.innerHTML = `<section class="hz-month preview-month" aria-hidden="true">${monthMarkup(false, true, `${nextCursor.getFullYear()}-${pad2(nextCursor.getMonth() + 1)}`)}</section>`;
      return;
    }
    if (state.view === 'schedule') {
      const pw = Math.max(minNavigableWeek(), state.week - 1);
      const nw = Math.min(maxNavigableWeek(), state.week + 1);
      const p = buildScheduleMarkup(pw, false);
      const n = buildScheduleMarkup(nw, false);
      prevEl.innerHTML = `<section class="hz-sched-shell"><div class="hz-sched-grid" style="--day-count:${p.dayCount}">${p.html}</div></section>`;
      nextEl.innerHTML = `<section class="hz-sched-shell"><div class="hz-sched-grid" style="--day-count:${n.dayCount}">${n.html}</div></section>`;
    } else {
      prevEl.innerHTML = '';
      nextEl.innerHTML = '';
    }
  };

  const renderAll = () => {
    state.week = clampNavigableWeek(state.week);
    const tt = currentTimetable();
    const hasTimetable = Boolean(tt);
    const days = dayInfo(state.week);

    const semEl = byId('hzSchedSemester');
    if (semEl) {
      const parts = (tt?.semester || '').split('-');
      semEl.textContent = parts.length === 3
        ? `${parts[0]}–${parts[1]} 学年第 ${parts[2]} 学期`
        : (tt?.semester || (tt ? tt.name : 'NO TIMETABLE'));
    }

    const ttSelect = byId<HTMLSelectElement>('hzSchedTimetableSelect');
    if (ttSelect) {
      ttSelect.hidden = state.timetables.length <= 1;
      if (state.timetables.length > 1) {
        ttSelect.innerHTML = state.timetables
          .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === state.activeId ? ' selected' : ''}>${escapeHtml(item.name)}${item.semester ? ` (${escapeHtml(item.semester)})` : ''}</option>`)
          .join('');
      }
    }

    const todayRo = byId('hzSchedTodayReadout');
    if (todayRo) todayRo.textContent = hasTimetable ? todayEyebrowLabel() : 'IDLE';

    const todayBtn = byId('hzSchedTodayBtn');
    if (todayBtn) todayBtn.textContent = todayButtonLabel();

    const next = nextCourseToday();
    const nextLbl = byId('hzTeleNextLabel');
    const nextVal = byId('hzTeleNextValue');
    if (nextLbl) nextLbl.textContent = next.label;
    if (nextVal) nextVal.textContent = next.value;

    const events = currentEvents();
    const courseCredits = new Map<string, number>();
    events.forEach((ev) => {
      const id = courseIdentity(ev);
      const credit = Number(ev.credit);
      if (!courseCredits.has(id) || (!Number.isFinite(courseCredits.get(id)) && Number.isFinite(credit))) {
        courseCredits.set(id, credit);
      }
    });
    const totalCredit = [...courseCredits.values()].reduce((sum, c) => sum + (Number.isFinite(c) ? c : 0), 0);
    const countVal = byId('hzTeleCountValue');
    if (countVal) {
      countVal.textContent = hasTimetable
        ? `${events.length} 课次 · ${courseCredits.size} 门 · ${totalCredit} 学分`
        : '--';
    }

    const campusCounts: Record<string, number> = {};
    events.forEach((ev) => {
      if (ev.campus && ev.campus !== '线上') campusCounts[ev.campus] = (campusCounts[ev.campus] || 0) + 1;
    });
    const mainCampus = Object.entries(campusCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || (hasTimetable ? '未标注校区' : '--');
    const campusVal = byId('hzTeleCampusValue');
    if (campusVal) campusVal.textContent = mainCampus;

    const weekValEl = byId('hzSchedNavVal');
    if (weekValEl) {
      weekValEl.textContent = state.view === 'month'
        ? monthLabel()
        : (state.week >= 1 && state.week <= maxWeek() ? `第 ${pad2(state.week)} 周` : weekLabel(state.week));
    }

    const visible = visibleEventsForWeek(state.week);
    const favCoursesCount = new Set(events.filter((ev) => ev.kind !== 'custom' && isFavoriteEvent(ev)).map(courseIdentity)).size;
    const viewTitleMap: Record<ViewMode, string> = {
      schedule: '周视图 · WEEKLY GRID',
      month: '月视图 · MONTHLY MATRIX',
      list: '列表视图 · AGENDA LEDGER',
      favorites: '收藏课程 · BOOKMARKED',
    };
    const barTitle = byId('hzSchedBarTitle');
    const barRange = byId('hzSchedBarRange');
    if (barTitle) barTitle.textContent = viewTitleMap[state.view];
    if (barRange) {
      barRange.textContent = !hasTimetable
        ? 'WAITING FOR BACKEND SCHEDULE'
        : state.view === 'favorites'
          ? `${favCoursesCount} 门已收藏 · ${visible.length} 个课次`
          : state.view === 'month'
            ? `${monthLabel()} · 共 ${monthEventCount()} 节课`
            : `${formatFull(days[0].fullDate)} — ${formatFull(days[6].fullDate)} · ${visible.length} 节`;
    }

    root.querySelectorAll<HTMLButtonElement>('[data-sched-view]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.schedView === state.view));
    });
    const weekendBtn = byId<HTMLButtonElement>('hzSchedWeekendBtn');
    if (weekendBtn) weekendBtn.setAttribute('aria-pressed', String(state.hideEmptyWeekends));

    const emptyRoot = byId('hzSchedEmptyRoot');
    const swipeViewport = byId('hzSwipeViewport');
    const gridEl = byId('hzSchedGrid');
    const weekEmptyEl = byId('hzSchedWeekEmpty');
    const shellEl = byId('hzSchedShell');
    const agendaEl = byId('hzSchedAgenda');
    const monthEl = byId('hzSchedMonth');

    if (!hasTimetable) {
      if (emptyRoot) emptyRoot.hidden = false;
      if (swipeViewport) swipeViewport.hidden = true;
      return;
    }
    if (emptyRoot) emptyRoot.hidden = true;
    if (swipeViewport) swipeViewport.hidden = false;

    if (shellEl) shellEl.hidden = state.view !== 'schedule';
    if (agendaEl) agendaEl.hidden = state.view !== 'list' && state.view !== 'favorites';
    if (monthEl) monthEl.hidden = state.view !== 'month';

    if (state.view === 'schedule' && gridEl) {
      const built = buildScheduleMarkup(state.week, true);
      scheduleAxis = built.axis;
      gridEl.style.setProperty('--day-count', String(built.dayCount));
      gridEl.innerHTML = built.html;
      if (weekEmptyEl) {
        if (built.events.length === 0) {
          const searching = Boolean(state.query.trim());
          weekEmptyEl.hidden = false;
          weekEmptyEl.innerHTML = `<p class="hz-mono">${searching ? 'NO MATCH' : 'FREE WEEK'}</p><p>${searching ? '没有匹配的课程或日程。' : '这一周没有课程安排。'}</p>${searching ? '<button type="button" class="hz-btn" data-sched-clear>清除搜索</button>' : ''}`;
        } else {
          weekEmptyEl.hidden = true;
          weekEmptyEl.innerHTML = '';
        }
      }
      bindEventTriggers(gridEl);
      if (weekEmptyEl) bindEventTriggers(weekEmptyEl);
    } else if ((state.view === 'list' || state.view === 'favorites') && agendaEl) {
      agendaEl.innerHTML = agendaMarkup(state.week, true);
      bindEventTriggers(agendaEl);
    } else if (state.view === 'month' && monthEl) {
      monthEl.innerHTML = monthMarkup(true);
      bindEventTriggers(monthEl);
    }

    renderPreviews();
    setSwipeTransform(0);
  };

  const navigateWeek = (delta: number) => {
    const next = clampNavigableWeek(state.week + delta);
    if (next === state.week) return false;
    state.week = next;
    renderAll();
    return true;
  };
  const navigateMonth = (delta: number) => {
    shiftMonth(delta);
    renderAll();
    return true;
  };

  const updateNowIndicator = () => {
    if (document.hidden || state.view !== 'schedule' || !currentTimetable()) return;
    const now = new Date();
    const today = currentWeekInfo();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const isCurrentWeek = state.week === today.week;
    const nowAbsolute = isCurrentWeek && nowMinutes < scheduleAxis.start ? nowMinutes + 1440 : nowMinutes;
    if (isCurrentWeek && nowAbsolute > scheduleAxis.end) {
      renderAll();
      return;
    }
    const line = byId('hzNowLine');
    if (!line) return;
    const show = isCurrentWeek && nowAbsolute >= scheduleAxis.start && nowAbsolute <= scheduleAxis.end;
    line.style.display = show ? '' : 'none';
    if (show) {
      line.style.top = `${Math.round((nowAbsolute - scheduleAxis.start) * scheduleAxis.pxPerMinute)}px`;
      const label = line.querySelector('.hz-now-label');
      if (label) label.textContent = formatClock(nowAbsolute);
    }
  };

  // ── 事件绑定 ──
  byId('hzSchedPrev')?.addEventListener('click', () => {
    state.view === 'month' ? navigateMonth(-1) : navigateWeek(-1);
  });
  byId('hzSchedNext')?.addEventListener('click', () => {
    state.view === 'month' ? navigateMonth(1) : navigateWeek(1);
  });
  byId('hzSchedTodayBtn')?.addEventListener('click', () => {
    const today = currentWeekInfo();
    state.week = clampNavigableWeek(today.week);
    state.day = today.day;
    const now = new Date();
    state.month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    renderAll();
  });

  byId<HTMLSelectElement>('hzSchedTimetableSelect')?.addEventListener('change', (e) => {
    state.activeId = (e.target as HTMLSelectElement).value;
    state.week = clampNavigableWeek(currentWeekInfo().week);
    saveVisitorPrefs();
    renderAll();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-sched-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.schedView as ViewMode;
      if (!next || next === state.view) return;
      state.view = next;
      saveVisitorPrefs();
      renderAll();
    });
  });

  byId('hzSchedWeekendBtn')?.addEventListener('click', () => {
    state.hideEmptyWeekends = !state.hideEmptyWeekends;
    saveVisitorPrefs();
    renderAll();
  });

  const searchInput = byId<HTMLInputElement>('hzSchedSearch');
  let searchTimer: number | undefined;
  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = searchInput.value.trim();
      renderAll();
    }, 150);
  });

  byId('hzDrawerBackdrop')?.addEventListener('click', closeDrawer);
  byId('hzDrawerClose')?.addEventListener('click', closeDrawer);
  byId('hzDrawerFav')?.addEventListener('click', () => {
    if (!activeEvent || activeEvent.kind === 'custom') return;
    const key = favoriteKey(activeEvent, currentTimetable()?.id || '');
    if (!key) return;
    const idx = state.favorites.indexOf(key);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(key);
    saveVisitorPrefs();
    openDrawer(activeEvent, activeEventWeek);
    if (state.view === 'favorites') renderAll();
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (e.key === '/' && !inInput) {
      e.preventDefault();
      searchInput?.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (document.body.classList.contains('hz-drawer-open')) {
        closeDrawer();
      } else if (state.query && searchInput) {
        state.query = '';
        searchInput.value = '';
        renderAll();
      }
      return;
    }
    if (!inInput && !document.body.classList.contains('hz-drawer-open') && (state.view === 'schedule' || state.view === 'month')) {
      if (e.key === 'ArrowLeft') {
        state.view === 'month' ? navigateMonth(-1) : navigateWeek(-1);
      } else if (e.key === 'ArrowRight') {
        state.view === 'month' ? navigateMonth(1) : navigateWeek(1);
      }
    }
  });

  // 移动端横向滑动切周 / 切月
  const surface = byId('hzSwipeSurface');
  if (surface) {
    surface.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'mouse' && window.innerWidth > 760) || !e.isPrimary) return;
      if (state.view !== 'schedule' && state.view !== 'month') return;
      stopSwipeAnimation();
      const now = performance.now();
      swipeState = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origin: swipePosition,
        velocity: 0,
        samples: [{ x: e.clientX, time: now }],
        horizontal: false,
        cancelled: false,
      };
      surface.dataset.swipeMoved = '0';
      surface.setPointerCapture?.(e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      if (!swipeState || e.pointerId !== swipeState.id || swipeState.cancelled) return;
      const dx = e.clientX - swipeState.startX;
      const dy = e.clientY - swipeState.startY;
      const now = performance.now();
      swipeState.samples.push({ x: e.clientX, time: now });
      swipeState.samples = swipeState.samples.filter((s) => now - s.time <= 120).slice(-5);
      const first = swipeState.samples[0];
      swipeState.velocity = (e.clientX - first.x) / Math.max(1, now - first.time);
      if (!swipeState.horizontal && Math.hypot(dx, dy) > 10) {
        if (Math.abs(dy) > Math.abs(dx)) {
          swipeState.cancelled = true;
          return;
        }
        swipeState.horizontal = true;
        surface.dataset.swipeMoved = '1';
      }
      if (!swipeState.horizontal) return;
      e.preventDefault();
      const width = byId('hzSwipeViewport')?.getBoundingClientRect().width || 320;
      setSwipeTransform(Math.max(-width, Math.min(width, swipeState.origin + dx)));
    });
    const finishSwipe = (e: PointerEvent) => {
      if (!swipeState || e.pointerId !== swipeState.id) return;
      const gesture = swipeState;
      swipeState = null;
      surface.releasePointerCapture?.(e.pointerId);
      if (!gesture.horizontal || gesture.cancelled) {
        animateSwipeTo(0);
        return;
      }
      const dx = e.clientX - gesture.startX;
      const vel = gesture.velocity || 0;
      const width = byId('hzSwipeViewport')?.getBoundingClientRect().width || 320;
      const threshold = Math.min(86, width * 0.2);
      const projected = dx + vel * 180;
      if (Math.abs(projected) <= threshold && Math.abs(vel) <= 0.32) {
        animateSwipeTo(0, vel * 1000);
        return;
      }
      const dir = Math.abs(vel) > 0.32 ? Math.sign(vel) : Math.sign(projected || dx);
      const delta = dir < 0 ? 1 : -1;
      if (state.view === 'month') {
        animateSwipeTo(delta > 0 ? -width : width, vel * 1000, () => navigateMonth(delta));
      } else {
        const next = state.week + delta;
        if (next < minNavigableWeek() || next > maxNavigableWeek()) {
          animateSwipeTo(0, vel * 1000);
          return;
        }
        animateSwipeTo(delta > 0 ? -width : width, vel * 1000, () => navigateWeek(delta));
      }
    };
    surface.addEventListener('pointerup', finishSwipe);
    surface.addEventListener('pointercancel', () => {
      swipeState = null;
      animateSwipeTo(0);
    });
    surface.addEventListener('click', (e) => {
      if (surface.dataset.swipeMoved === '1') {
        e.preventDefault();
        e.stopPropagation();
        surface.dataset.swipeMoved = '0';
      }
    }, true);
  }

  renderAll();
  window.setInterval(updateNowIndicator, 15000);
}

initSchedulePage();
