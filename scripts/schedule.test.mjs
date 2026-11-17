import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayRoom,
  eventEndMinute,
  eventInWeek,
  eventStartMinute,
  normalizeSchedulePayload,
  parseWeekRangesText,
  roomDisplayParts,
  timeLabel,
} from '../src/lib/schedule-core.mjs';
import { detectCampusConflicts, parseTimetablePages } from '../admin/src/lib/wmu-timetable.mjs';

test('normalizeSchedulePayload accepts empty v2 schedule and clamps slotHeight', () => {
  const res = normalizeSchedulePayload({
    version: 2,
    timetables: [],
    activeId: null,
    slotHeight: 200,
    hideEmptyWeekends: true,
  });
  assert.ok(res);
  assert.equal(res.version, 2);
  assert.deepEqual(res.timetables, []);
  assert.equal(res.activeId, null);
  assert.equal(res.slotHeight, 144);
  assert.equal(res.hideEmptyWeekends, true);
});

test('normalizeSchedulePayload normalizes v2 timetable with courses, custom events, and aliases', () => {
  const res = normalizeSchedulePayload({
    version: 2,
    activeId: 'tt-1',
    timetables: [
      {
        id: 'tt-1',
        name: '2026-2027-1',
        semester: '2026-2027-1',
        termStartDate: '2026-09-07',
        events: [
          {
            day: 2,
            start: 1,
            end: 2,
            title: '系统解剖学',
            type: 'lecture',
            campus: '茶山校区',
            room: '7A101（智慧教室）',
            teacher: '张老师',
            weeks: [{ start: 1, end: 16, parity: 'all' }],
            credit: '4.5',
          },
        ],
        customEvents: [
          {
            id: 'c-1',
            title: '实验组会',
            week: 3,
            day: 4,
            startTime: '19:00',
            endTime: '20:30',
            color: 'gold',
          },
        ],
        courseAliases: [
          { key: 'title:系统解剖学', global: '解剖学', weeks: { 3: '第3周解剖' } },
        ],
      },
    ],
  });
  assert.ok(res);
  assert.equal(res.timetables.length, 1);
  const ev = res.timetables[0].events[0];
  assert.equal(timeLabel(ev), '08:00–09:25');
  assert.equal(displayRoom(ev), '7A101');
  assert.deepEqual(roomDisplayParts(ev), { room: '7A101', code: '7A101', extra: '' });
  assert.equal(eventStartMinute(ev), 480);
  assert.equal(eventEndMinute(ev), 565);
  assert.equal(res.timetables[0].customEvents[0].kind, 'custom');
  assert.equal(res.timetables[0].courseAliases[0].weeks['3'], '第3周解剖');
});

test('eventInWeek respects odd/even parity and custom event week', () => {
  const oddCourse = {
    weeks: [{ start: 1, end: 10, parity: 'odd' }],
  };
  assert.equal(eventInWeek(oddCourse, 1), true);
  assert.equal(eventInWeek(oddCourse, 2), false);
  assert.equal(eventInWeek(oddCourse, 9), true);
  assert.equal(eventInWeek({ kind: 'custom', week: 5 }, 5), true);
  assert.equal(eventInWeek({ kind: 'custom', week: 5 }, 6), false);
});

test('parseWeekRangesText parses mixed ranges and parity', () => {
  assert.deepEqual(parseWeekRangesText('1-8周(单), 10-12周, 15周(双)'), [
    { start: 1, end: 8, parity: 'odd' },
    { start: 10, end: 12, parity: 'all' },
    { start: 15, end: 15, parity: 'even' },
  ]);
});

test('wmu-timetable parser parses synthetic column and detects cross-campus conflict', () => {
  const pages = [
    {
      width: 842,
      height: 595,
      items: [
        { str: '2026-2027学年第1学期', transform: [1, 0, 0, 1, 100, 560] },
        { str: '星期一', transform: [1, 0, 0, 1, 120, 520] },
        { str: '星期二', transform: [1, 0, 0, 1, 220, 520] },
        { str: '星期三', transform: [1, 0, 0, 1, 320, 520] },
        { str: '星期四', transform: [1, 0, 0, 1, 420, 520] },
        { str: '星期五', transform: [1, 0, 0, 1, 520, 520] },
        { str: '星期六', transform: [1, 0, 0, 1, 620, 520] },
        { str: '星期日', transform: [1, 0, 0, 1, 720, 520] },
        { str: '人体解剖学', transform: [1, 0, 0, 1, 120, 480] },
        { str: '◆(1-2节)1-16周/校区:茶山校区/场地:7A101/教师:张三/学分:4.0', transform: [1, 0, 0, 1, 120, 465] },
      ],
    },
  ];
  const parsed = parseTimetablePages(pages);
  assert.equal(parsed.semester, '2026-2027-1');
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].courseName, '人体解剖学');
  assert.equal(parsed.events[0].campus, '茶山校区');

  const conflicts = detectCampusConflicts([
    {
      courseName: '课A',
      weekday: 1,
      campus: '茶山校区',
      periods: { start: 1, end: 2 },
      weeks: [{ start: 1, end: 8, parity: 'all' }],
    },
    {
      courseName: '课B',
      weekday: 1,
      campus: '滨海校区',
      periods: { start: 1, end: 2 },
      weeks: [{ start: 2, end: 6, parity: 'even' }],
    },
  ]);
  assert.equal(conflicts.length, 1);
});
