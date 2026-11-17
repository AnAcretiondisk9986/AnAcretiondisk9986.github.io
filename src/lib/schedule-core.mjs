/**
 * 温医大课表与个人日程共享核心（前后端共用）。
 * 包含校区作息时间表、周次/日期计算、教室编码拆分、数据校验与 v1/v2 归一化。
 */

export const DAY_NAMES = Object.freeze(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);

export const ACTIVITY_LABELS = Object.freeze({
  independent: '自主学习',
  online: '在线',
  lecture: '讲课',
  lab: '实验',
  discussion: '讨论',
  practice: '实践',
  custom: '自定义',
});

export const VALID_EVENT_TYPES = new Set([
  'lecture',
  'lab',
  'online',
  'discussion',
  'practice',
  'independent',
  'custom',
]);

export const VALID_COLORS = new Set(['brand', 'gold', 'blue', 'mint', 'violet']);
export const MAX_PERIOD = 22;
export const MAX_BACKUP_TEXT = 500;
export const DEFAULT_SLOT_HEIGHT = 72;
export const MIN_SLOT_HEIGHT = 48;
export const MAX_SLOT_HEIGHT = 144;

export const SHARED_AFTERNOON_PERIODS = Object.freeze([
  ['13:30', '14:10'],
  ['14:15', '14:55'],
  ['15:00', '15:40'],
  ['15:45', '16:25'],
  ['16:30', '17:10'],
  ['17:15', '17:55'],
  ['18:20', '19:00'],
  ['19:05', '19:45'],
  ['19:50', '20:30'],
  ['20:35', '21:15'],
  ['21:20', '22:00'],
  ['22:05', '22:45'],
  ['22:50', '23:30'],
  ['23:35', '00:15'],
  ['00:20', '01:00'],
]);

export const CHASHAN_PERIODS = Object.freeze([
  ['08:00', '08:40'],
  ['08:45', '09:25'],
  ['09:40', '10:20'],
  ['10:25', '11:05'],
  ['11:10', '11:50'],
  ['11:55', '12:35'],
  ['12:40', '13:20'],
  ...SHARED_AFTERNOON_PERIODS,
]);

export const BINHAI_PERIODS = Object.freeze([
  ['08:30', '09:10'],
  ['09:15', '09:55'],
  ['10:10', '10:50'],
  ['10:55', '11:35'],
  ['11:40', '12:20'],
  ['12:25', '13:05'],
  ['13:05', '13:20'],
  ...SHARED_AFTERNOON_PERIODS,
]);

export const CAMPUS_PERIODS = Object.freeze({
  茶山校区: CHASHAN_PERIODS,
  学院路校区: CHASHAN_PERIODS,
  滨海校区: BINHAI_PERIODS,
  线上: BINHAI_PERIODS,
});

export const pad2 = (value) => String(value).padStart(2, '0');

export const mondayOf = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

export const addDays = (date, count) => {
  const d = new Date(date);
  d.setDate(d.getDate() + count);
  return d;
};

export const toIso = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
export const formatMD = (date) => `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
export const formatFull = (date) => `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;

export const timeToMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export const formatClock = (minutes) => {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
};

export const periodMinutes = (periods, index, edge) => {
  const value = periods[index]?.[edge];
  if (!value) return null;
  let minutes = timeToMinutes(value);
  if (index >= 20 && minutes < 8 * 60) minutes += 1440;
  return minutes;
};

export const clampSlotHeight = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SLOT_HEIGHT;
  return Math.min(MAX_SLOT_HEIGHT, Math.max(MIN_SLOT_HEIGHT, Math.round(numeric / 4) * 4));
};

export const safeText = (value, fallback = '', limit = MAX_BACKUP_TEXT) => {
  const text = String(value ?? fallback).trim();
  return text.slice(0, limit);
};

export const integerInRange = (value, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};

export const validClock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));

export const validDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(`${value}T00:00:00`);
  return (
    !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(match[1])
    && date.getMonth() + 1 === Number(match[2])
    && date.getDate() === Number(match[3])
  );
};

export const validMonth = (value) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(`${value}-01T00:00:00`);
  return (
    !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(match[1])
    && date.getMonth() + 1 === Number(match[2])
  );
};

export function parseWeekRangesText(value) {
  const source = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u3000\t ]+/g, ' ')
    .replace(/[，；;,、]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\((单|双)周\)/g, '($1)')
    .replace(/单周/g, '(单)')
    .replace(/双周/g, '(双)')
    .replace(/[～~—－至]/g, '-')
    .trim();
  if (!source) return [];
  const ranges = [];
  const pattern = /(?:第\s*)?(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*周?(?:\s*\((单|双)\))?/g;
  for (const part of source.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    pattern.lastIndex = 0;
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start >= 1 && end <= 30 && end >= start) {
      ranges.push({
        start,
        end,
        parity: match[3] === '单' ? 'odd' : match[3] === '双' ? 'even' : 'all',
      });
    }
  }
  return ranges;
}

export const weeksLabel = (weeks) => (
  Array.isArray(weeks) && weeks.length
    ? `${weeks.map((range) => {
        const span = range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`;
        return `${span}${range.parity === 'odd' ? '（单）' : range.parity === 'even' ? '（双）' : ''}`;
      }).join('、')} 周`
    : '周次未标注'
);

export const eventInWeek = (event, week) => (
  event.kind === 'custom'
    ? Number(event.week) === week
    : (event.weeks || []).some((range) => (
        week >= range.start
        && week <= range.end
        && (range.parity === 'all' || (range.parity === 'odd' && week % 2 === 1) || (range.parity === 'even' && week % 2 === 0))
      ))
);

export const eventStartMinute = (event) => {
  if (event.kind === 'custom') return timeToMinutes(event.startTime);
  const periods = CAMPUS_PERIODS[event.campus] || CAMPUS_PERIODS['滨海校区'];
  return periodMinutes(periods, event.start - 1, 0);
};

export const eventEndMinute = (event) => {
  if (event.kind === 'custom') return timeToMinutes(event.endTime);
  const periods = CAMPUS_PERIODS[event.campus] || CAMPUS_PERIODS['滨海校区'];
  let end = periodMinutes(periods, event.end - 1, 1);
  const start = eventStartMinute(event);
  if (end != null && start != null && end < start) end += 1440;
  return end;
};

export const timeLabel = (event) => {
  if (event.kind === 'custom') return `${event.startTime}–${event.endTime}`;
  const periods = CAMPUS_PERIODS[event.campus] || CAMPUS_PERIODS['滨海校区'];
  const startClock = periods[event.start - 1]?.[0] || '08:00';
  const endClock = periods[event.end - 1]?.[1] || '08:40';
  return `${startClock}–${endClock}`;
};

export const displayRoom = (event) => {
  const room = String(event.room || (event.kind === 'custom' ? '未设置地点' : '待定')).trim();
  const leadingCode = room.match(/^([A-Za-z0-9]{4,6})(?=[^A-Za-z0-9]|$)/)?.[1];
  if (!leadingCode) return room;
  if (event.campus === '茶山校区') {
    return room.replace(/\s*[（(]\s*智慧教室\s*[）)]\s*/g, ' ').trim();
  }
  if (event.campus === '滨海校区') {
    return room
      .replace(/\s*[（(]\s*智慧教室\s*[）)]\s*/g, ' ')
      .replace(/\s*计算机机房\s*$/g, '')
      .trim();
  }
  return room;
};

export const roomDisplayParts = (event) => {
  const room = displayRoom(event);
  const match = room.match(/^([A-Za-z0-9]{4,6})(?=[^A-Za-z0-9]|$)/);
  if (!match) return { room, code: '', extra: '' };
  return { room, code: match[1], extra: room.slice(match[1].length).trim() };
};

export const isOnlinePlatformRoom = (room) => /学习通|超星|雨课堂|钉钉|腾讯会议|在线学习|线上课堂|同步课堂|在线教学平台|网络教学平台/i.test(String(room || ''));

export const isMissingRoom = (room) => {
  const value = String(room || '').trim();
  return !value || /^(?:待定|无地点|未标注(?:地点|教室|场地)|暂无)$/i.test(value);
};

export const courseLayer = (event) => {
  if (event.kind === 'custom') return 'custom';
  if (event.type === 'lecture') return 'lecture';
  if (isOnlinePlatformRoom(event.room)) return 'platform';
  if (isMissingRoom(event.room)) return 'missing';
  if (event.type === 'online' || event.campus === '线上') return 'online';
  return 'standard';
};

export const normalizeFavoritePart = (value) => safeText(value, '', 240).toLowerCase().replace(/\s+/g, ' ');

export const courseIdentity = (event) => {
  const code = normalizeFavoritePart(event?.courseCode);
  const className = normalizeFavoritePart(event?.className);
  const title = normalizeFavoritePart(event?.title ?? event?.courseName);
  return code ? `code:${code}` : className ? `class:${className}` : `title:${title}`;
};

export const favoriteKey = (event, timetableId = '') => {
  if (!event || typeof event !== 'object') return '';
  const owner = safeText(timetableId || event.timetableId, '', 120);
  const identity = courseIdentity(event);
  return owner && identity ? `${owner}::${identity}` : identity;
};

export const courseAliasKey = (event) => {
  const part = normalizeFavoritePart(event?.courseCode) || normalizeFavoritePart(event?.className) || normalizeFavoritePart(event?.title);
  return part ? `${event?.courseCode ? 'code' : event?.className ? 'class' : 'title'}:${part}` : '';
};

export const aliasEntryFor = (event, timetable) => {
  const key = courseAliasKey(event);
  return key ? (timetable?.courseAliases || []).find((entry) => entry.key === key) || null : null;
};

export const eventDisplayTitle = (event, week, timetable) => {
  if (event.kind === 'custom') return event.title;
  const entry = aliasEntryFor(event, timetable);
  return entry?.weeks?.[String(week)] || entry?.global || event.title;
};

export const eventFromParsed = (event) => ({
  day: event.weekday ?? event.day,
  start: event.periods?.start ?? event.start,
  end: event.periods?.end ?? event.end,
  title: event.courseName || event.title,
  type: event.activity || event.type || 'lecture',
  label: event.activityLabel || event.label || ACTIVITY_LABELS[event.activity || event.type] || '讲课',
  room: event.room || '待定',
  campus: event.campus || '未标注校区',
  teacher: event.teacher || '待定',
  weeks: event.weeks || [],
  credit: event.credit == null ? '—' : String(event.credit),
  courseCode: event.courseCode || '',
  className: event.className || '',
  classComposition: event.classComposition || '',
  assessment: event.assessment || '',
  note: event.note || '',
  courseHours: event.courseHours || '',
  weeklyHours: event.weeklyHours ?? null,
  totalHours: event.totalHours ?? null,
});

export function normalizeWeeks(value, allowNegative = false) {
  if (!Array.isArray(value)) return null;
  const min = allowNegative ? -52 : 1;
  const ranges = value.map((range) => {
    if (!range || typeof range !== 'object') return null;
    const start = integerInRange(range.start, min, 99);
    const end = integerInRange(range.end, min, 99);
    const parity = ['all', 'odd', 'even'].includes(range.parity) ? range.parity : null;
    if (start == null || end == null || end < start || !parity) return null;
    return { start, end, parity };
  });
  return ranges.every(Boolean) ? ranges : null;
}

export function normalizeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const custom = value.kind === 'custom' || value.type === 'custom';
  const title = safeText(value.title ?? value.courseName);
  const day = integerInRange(value.day ?? value.weekday, 1, 7);
  if (!title || day == null) return null;

  if (custom) {
    const week = integerInRange(value.week ?? value.weeks?.[0]?.start, -52, 99);
    const startTime = safeText(value.startTime, '', 5);
    const endTime = safeText(value.endTime, '', 5);
    if (week == null || !validClock(startTime) || !validClock(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      return null;
    }
    return {
      id: safeText(value.id, `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, 120),
      kind: 'custom',
      title,
      description: safeText(value.description, '', 120),
      room: safeText(value.room, '', 120),
      week,
      day,
      startTime,
      endTime,
      color: VALID_COLORS.has(value.color) ? value.color : 'brand',
      type: 'custom',
      label: '自定义',
      campus: '',
      teacher: '',
      credit: '—',
      hidden: value.hidden === true,
      weeks: [{ start: week, end: week, parity: 'all' }],
    };
  }

  const start = integerInRange(value.start ?? value.periods?.start, 1, MAX_PERIOD);
  const end = integerInRange(value.end ?? value.periods?.end, 1, MAX_PERIOD);
  const rawType = value.type ?? value.activity ?? 'lecture';
  const type = VALID_EVENT_TYPES.has(rawType) ? rawType : null;
  const weeks = normalizeWeeks(value.weeks);
  if (start == null || end == null || end < start || !type || !weeks || !weeks.length) return null;

  return {
    day,
    start,
    end,
    title,
    type,
    label: safeText(value.label ?? value.activityLabel, ACTIVITY_LABELS[type] || '讲课', 40),
    room: safeText(value.room, '', 160) || '待定',
    campus: safeText(value.campus, '', 80) || '未标注校区',
    teacher: safeText(value.teacher, '', 120) || '待定',
    weeks,
    credit: value.credit == null ? '—' : safeText(value.credit, '—', 30),
    courseCode: safeText(value.courseCode, '', 80),
    className: safeText(value.className, '', 180),
    classComposition: safeText(value.classComposition, '', 180),
    assessment: safeText(value.assessment, '', 120),
    note: safeText(value.note, '', 240),
    courseHours: safeText(value.courseHours, '', 120),
    weeklyHours: value.weeklyHours == null || !Number.isFinite(Number(value.weeklyHours)) ? null : Number(value.weeklyHours),
    totalHours: value.totalHours == null || !Number.isFinite(Number(value.totalHours)) ? null : Number(value.totalHours),
    cardColor: VALID_COLORS.has(value.cardColor) ? value.cardColor : '',
    hidden: value.hidden === true,
  };
}

export function normalizeCourseAliases(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1000).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const key = safeText(entry.key, '', 320);
    const global = safeText(entry.global, '', 80);
    const weeks = {};
    if (entry.weeks && typeof entry.weeks === 'object' && !Array.isArray(entry.weeks)) {
      Object.entries(entry.weeks).forEach(([week, alias]) => {
        const number = integerInRange(week, -52, 99);
        const text = safeText(alias, '', 80);
        if (number != null && text) weeks[String(number)] = text;
      });
    }
    return key && (global || Object.keys(weeks).length) ? { key, global, weeks } : null;
  }).filter(Boolean);
}

export function normalizeTimetable(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = safeText(value.id, '', 120);
  if (!id || !Array.isArray(value.events)) return null;
  const customRaw = Array.isArray(value.customEvents) ? value.customEvents : [];
  const events = value.events.map(normalizeEvent);
  const customEvents = customRaw.map((item) => normalizeEvent({ ...item, kind: 'custom', type: 'custom' }));
  if (events.some((event) => !event) || customEvents.some((event) => !event || event.kind !== 'custom')) {
    return null;
  }
  const termStartDate = validDate(value.termStartDate) ? value.termStartDate : '';
  return {
    id,
    name: safeText(value.name, '', 120) || '课表',
    semester: safeText(value.semester, '', 80),
    student: {
      name: safeText(value.student?.name, '', 80),
      id: safeText(value.student?.id, '', 80),
    },
    termStartDate,
    termStartConfirmed: value.termStartConfirmed !== false && Boolean(termStartDate),
    events,
    customEvents,
    courseAliases: normalizeCourseAliases(value.courseAliases),
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
  };
}

/**
 * 归一化课表存储结构（支持 v2 与 v1 旧格式，也允许空课表数组）。
 * 格式不合法时返回 null。
 */
export function normalizeSchedulePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  // 兼容 WMU 课表 v1 单课表备份
  if (value.version === 1 && Array.isArray(value.events)) {
    const events = value.events.map(eventFromParsed).map(normalizeEvent);
    if (events.some((event) => !event)) return null;
    const id = safeText(value.id, 'tt-imported-v1', 120) || 'tt-imported-v1';
    const termStartDate = validDate(value.termStartDate) ? value.termStartDate : '';
    return {
      version: 2,
      timetables: [{
        id,
        name: safeText(value.semester, '课表 1', 120) || '课表 1',
        semester: safeText(value.semester, '', 80),
        student: {
          name: safeText(value.student?.name, '', 80),
          id: safeText(value.student?.id, '', 80),
        },
        termStartDate,
        termStartConfirmed: Boolean(termStartDate),
        events,
        customEvents: [],
        courseAliases: [],
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
      }],
      activeId: id,
      favorites: Array.isArray(value.favorites)
        ? value.favorites.filter((item) => typeof item === 'string').map((item) => item.slice(0, 420))
        : [],
      slotHeight: clampSlotHeight(value.slotHeight),
      hideEmptyWeekends: value.hideEmptyWeekends === true,
      updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
    };
  }

  if (value.version !== 2 || !Array.isArray(value.timetables)) return null;
  const timetables = value.timetables.map(normalizeTimetable);
  if (timetables.some((tt) => !tt)) return null;
  if (new Set(timetables.map((tt) => tt.id)).size !== timetables.length) return null;

  const activeId = timetables.length
    ? (timetables.some((tt) => tt.id === value.activeId) ? value.activeId : timetables[0].id)
    : null;

  return {
    version: 2,
    timetables,
    activeId,
    favorites: Array.isArray(value.favorites)
      ? value.favorites.filter((item) => typeof item === 'string').map((item) => item.slice(0, 420))
      : [],
    slotHeight: value.slotHeight == null ? DEFAULT_SLOT_HEIGHT : clampSlotHeight(value.slotHeight),
    hideEmptyWeekends: value.hideEmptyWeekends === true,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
  };
}
