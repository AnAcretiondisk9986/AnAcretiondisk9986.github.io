export interface WeekRange {
  start: number;
  end: number;
  parity: 'all' | 'odd' | 'even';
}

export type ScheduleActivityType =
  | 'lecture'
  | 'lab'
  | 'online'
  | 'discussion'
  | 'practice'
  | 'independent'
  | 'custom';

export type ScheduleCardColor = 'brand' | 'gold' | 'blue' | 'mint' | 'violet';

export interface CourseEvent {
  kind?: undefined;
  day: number;
  start: number;
  end: number;
  title: string;
  type: ScheduleActivityType;
  label: string;
  room: string;
  campus: string;
  teacher: string;
  weeks: WeekRange[];
  credit: string;
  courseCode: string;
  className: string;
  classComposition: string;
  assessment: string;
  note: string;
  courseHours: string;
  weeklyHours: number | null;
  totalHours: number | null;
  cardColor?: ScheduleCardColor | '';
  hidden?: boolean;
}

export interface CustomScheduleEvent {
  id: string;
  kind: 'custom';
  title: string;
  description: string;
  room: string;
  week: number;
  day: number;
  startTime: string;
  endTime: string;
  color: ScheduleCardColor;
  type: 'custom';
  label: string;
  campus: string;
  teacher: string;
  credit: string;
  hidden?: boolean;
  weeks: WeekRange[];
}

export type AnyScheduleEvent = CourseEvent | CustomScheduleEvent;

export interface CourseAliasEntry {
  key: string;
  global: string;
  weeks: Record<string, string>;
}

export interface TimetableData {
  id: string;
  name: string;
  semester: string;
  student: { name: string; id: string };
  termStartDate: string;
  termStartConfirmed: boolean;
  events: CourseEvent[];
  customEvents: CustomScheduleEvent[];
  courseAliases: CourseAliasEntry[];
  updatedAt: number;
}

export interface SchedulePayload {
  version: 2;
  timetables: TimetableData[];
  activeId: string | null;
  favorites: string[];
  slotHeight: number;
  hideEmptyWeekends: boolean;
  updatedAt: number;
}

export const DAY_NAMES: readonly string[];
export const ACTIVITY_LABELS: Readonly<Record<ScheduleActivityType, string>>;
export const CAMPUS_PERIODS: Readonly<Record<string, readonly [string, string][]>>;
export const DEFAULT_SLOT_HEIGHT: number;
export const MIN_SLOT_HEIGHT: number;
export const MAX_SLOT_HEIGHT: number;

export function pad2(value: number): string;
export function mondayOf(date: Date | string | number): Date;
export function addDays(date: Date | string | number, count: number): Date;
export function toIso(date: Date): string;
export function formatMD(date: Date): string;
export function formatFull(date: Date): string;
export function timeToMinutes(hhmm: string): number;
export function formatClock(minutes: number): string;
export function clampSlotHeight(value: unknown): number;
export function validDate(value: unknown): boolean;
export function validMonth(value: unknown): boolean;
export function weeksLabel(weeks: WeekRange[]): string;
export function eventInWeek(event: AnyScheduleEvent, week: number): boolean;
export function eventStartMinute(event: AnyScheduleEvent): number | null;
export function eventEndMinute(event: AnyScheduleEvent): number | null;
export function timeLabel(event: AnyScheduleEvent): string;
export function displayRoom(event: AnyScheduleEvent): string;
export function roomDisplayParts(event: AnyScheduleEvent): { room: string; code: string; extra: string };
export function isOnlinePlatformRoom(room: string): boolean;
export function isMissingRoom(room: string): boolean;
export function courseLayer(event: AnyScheduleEvent): string;
export function courseIdentity(event: AnyScheduleEvent): string;
export function favoriteKey(event: AnyScheduleEvent, timetableId?: string): string;
export function courseAliasKey(event: AnyScheduleEvent): string;
export function aliasEntryFor(event: AnyScheduleEvent, timetable?: TimetableData | null): CourseAliasEntry | null;
export function eventDisplayTitle(event: AnyScheduleEvent, week: number, timetable?: TimetableData | null): string;
export function normalizeSchedulePayload(value: unknown): SchedulePayload | null;
