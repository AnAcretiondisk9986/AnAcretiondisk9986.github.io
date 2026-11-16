export type CourseStatus = 'completed' | 'active' | 'planned';

export interface AcademicCourse {
  id: string;
  code: string;
  name: string;
  en?: string;
  credits: number;
  kind?: 'course' | 'milestone';
  milestoneSpan?: number;
  milestoneLabel?: string;
  dept: string;
  nature: string;
  semesterId: string;
  track: 'orig' | 'clin';
  status: CourseStatus;
  segments?: number;
  early?: boolean;
  earlyNote?: string;
  recognizedNote?: string;
  grade?: string;
  gpa?: number | null;
  note?: string;
  posts?: string[];
  linkedIds?: string[];
}

export interface AcademicSemester {
  id: string;
  track: 'orig' | 'clin';
  year: string;
  term: string;
  label: string;
  sub: string;
  hue: number;
}

export interface AcademicTrackMeta {
  id: 'orig' | 'clin';
  code: string;
  name: string;
  span: string;
  note: string;
}

export interface AcademicToolLink {
  label: string;
  href: string;
  note?: string;
}

export interface AcademicData {
  meta: {
    title: string;
    subtitle: string;
    updatedAt: string;
    activeTermLabel: string;
  };
  tracks: {
    orig: AcademicTrackMeta;
    clin: AcademicTrackMeta;
  };
  transfer: {
    date: string;
    title: string;
    summary: string;
    posts: string[];
  };
  tools: AcademicToolLink[];
  semesters: AcademicSemester[];
  courses: AcademicCourse[];
}

export interface GridPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackedCourse extends AcademicCourse {
  hue: number;
  semesterLabel: string;
  semesterYear: string;
  mainTitle: string;
  subTags: string[];
  titleRemD: number;
  titleRemM: number;
  desktop: GridPlacement;
  tablet: GridPlacement;
  mobile: GridPlacement;
}

export interface PackedSemester extends AcademicSemester {
  courses: PackedCourse[];
  totalCredits: number;
  litCredits: number;
  desktopRows: number;
  tabletRows: number;
  mobileRows: number;
}

export interface AxisSegment {
  semesterId: string;
  year: string;
  shortYear: string;
  label: string;
  shortLabel: string;
  showYear: boolean;
  hue: number;
  desktopRow: number;
  desktopSpan: number;
  tabletRow: number;
  tabletSpan: number;
  mobileRow: number;
  mobileSpan: number;
}

export interface PackedTrackWall {
  courses: PackedCourse[];
  axis: AxisSegment[];
  desktopRows: number;
  tabletRows: number;
  mobileRows: number;
}

const creditWeight = (credits: number) => Math.pow(Math.max(0.5, credits), 0.78) + 0.55;

/** Hamilton / Largest-Remainder apportionment summing strictly to `total` with `minEach` floor. */
function apportion(weights: number[], total: number, minEach: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n * minEach >= total) {
    const base = Math.floor(total / n);
    const rem = total - base * n;
    return weights.map((_, i) => base + (i < rem ? 1 : 0));
  }
  const extra = total - n * minEach;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * extra);
  const ints = raw.map((v) => Math.floor(v) + minEach);
  const rem = total - ints.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) {
    ints[order[k].i] += 1;
  }
  return ints;
}

interface IndexedCourse {
  course: AcademicCourse;
  idx: number;
}

/**
 * 2D 满幅 Bento 拼版求解器：
 * 保证每个学期内部 100% 无空隙、无重叠地铺满 totalCols 列，
 * 同时通过「2行主课 + 双层伴随课」组合使高学分课程自然占据更大版面且文字保持横向易读。
 */
export function solveGridPacking(
  courses: AcademicCourse[],
  totalCols: number,
  minW: number,
  startBandIdx = 0,
): { map: Map<string, GridPlacement>; rows: number; nextBandIdx: number } {
  const map = new Map<string, GridPlacement>();
  if (courses.length === 0) return { map, rows: 0, nextBandIdx: startBandIdx };

  const sorted: IndexedCourse[] = courses
    .map((course, idx) => ({ course, idx }))
    .sort((a, b) => b.course.credits - a.course.credits || a.idx - b.idx);

  let pool = [...sorted];
  let rowY = 1;
  let bandIdx = startBandIdx;

  while (pool.length > 0) {
    const n = pool.length;

    // Small trailing group fits neatly on a single full-width row
    if (n <= 4 && !(totalCols >= 24 && n === 4 && pool[0].course.credits >= 4.5 && pool[1].course.credits <= 2.5)) {
      const maxSingleRow = Math.floor(totalCols / minW);
      if (n <= maxSingleRow) {
        const ws = apportion(
          pool.map((x) => creditWeight(x.course.credits)),
          totalCols,
          minW,
        );
        let x = 1;
        pool.forEach((it, i) => {
          map.set(it.course.id, { x, y: rowY, w: ws[i], h: 1 });
          x += ws[i];
        });
        rowY += 1;
        bandIdx += 1;
        break;
      }
    }

    const canTwoTall = totalCols >= 24 && n >= 6 && n <= 9 && pool[1].course.credits >= 3.5;
    const tallCount = canTwoTall ? 2 : totalCols >= 12 && n >= 4 && pool[0].course.credits >= 3.0 ? 1 : 0;

    if (tallCount > 0) {
      const talls = pool.slice(0, tallCount);
      const rest = pool.slice(tallCount);
      const maxPerSideSubRow = totalCols >= 24 ? 4 : 2;
      const maxComp = Math.min(rest.length, maxPerSideSubRow * 2);
      let compCount = maxComp;
      const minRemain = totalCols >= 24 ? 3 : 2;
      if (rest.length > maxComp && rest.length - maxComp < minRemain) {
        compCount = Math.max(2, rest.length - minRemain);
      }

      const minTallEach = tallCount === 2 ? Math.max(minW + 2, 5) : Math.max(minW + 1, Math.round(totalCols * 0.25));
      const minSideW = Math.ceil(compCount / 2) * minW;
      const maxTallSum = totalCols - minSideW;
      const tallMinSum = tallCount * minTallEach;

      if (compCount >= 2 && maxTallSum >= tallMinSum) {
        const chosenComp = rest.slice(rest.length - compCount);
        const nextPool = rest.slice(0, rest.length - compCount);

        const tallWeight = talls.reduce((s, x) => s + creditWeight(x.course.credits), 0);
        const compWeight = chosenComp.reduce((s, x) => s + creditWeight(x.course.credits), 0);
        const desiredTallSpan = Math.round((tallWeight / (tallWeight + compWeight)) * totalCols * 1.15);
        const tallSpan = Math.max(tallMinSum, Math.min(maxTallSum, desiredTallSpan));
        const tallWidths = apportion(
          talls.map((x) => creditWeight(x.course.credits)),
          tallSpan,
          minTallEach,
        );
        const tallTotalW = tallWidths.reduce((a, b) => a + b, 0);
        const sideW = totalCols - tallTotalW;

        chosenComp.sort((a, b) => b.course.credits - a.course.credits || a.idx - b.idx);
        const topCount = Math.max(1, Math.floor(chosenComp.length / 2));
        const topItems = chosenComp.slice(0, topCount);
        const botItems = chosenComp.slice(topCount);

        if (topItems.length * minW <= sideW && botItems.length * minW <= sideW) {
          const tallOnRight = bandIdx % 2 === 1;
          const compStartX = tallOnRight ? 1 : 1 + tallTotalW;
          let tx = tallOnRight ? 1 + sideW : 1;
          for (let t = 0; t < talls.length; t++) {
            map.set(talls[t].course.id, { x: tx, y: rowY, w: tallWidths[t], h: 2 });
            tx += tallWidths[t];
          }

          const topW = apportion(
            topItems.map((x) => creditWeight(x.course.credits)),
            sideW,
            minW,
          );
          let cx = compStartX;
          topItems.forEach((it, i) => {
            map.set(it.course.id, { x: cx, y: rowY, w: topW[i], h: 1 });
            cx += topW[i];
          });

          const botW = apportion(
            botItems.map((x) => creditWeight(x.course.credits)),
            sideW,
            minW,
          );
          cx = compStartX;
          botItems.forEach((it, i) => {
            map.set(it.course.id, { x: cx, y: rowY + 1, w: botW[i], h: 1 });
            cx += botW[i];
          });

          pool = nextPool;
          rowY += 2;
          bandIdx += 1;
          continue;
        }
      }
    }

    // Single-row balanced strip
    const maxRow = Math.max(2, Math.floor(totalCols / minW));
    const preferredMax = totalCols <= 12 && pool[0].course.credits >= 3.5 ? Math.min(3, maxRow) : maxRow;
    let take = n <= preferredMax ? n : Math.min(preferredMax, Math.max(2, Math.ceil(n / Math.ceil(n / preferredMax))));
    if (n - take === 1 && take > 2) take -= 1;

    const rowItems: IndexedCourse[] = [];
    for (let k = 0; k < take; k++) {
      const picked = k % 2 === 0 ? pool.shift() : pool.pop();
      if (picked) rowItems.push(picked);
    }
    rowItems.sort((a, b) => b.course.credits - a.course.credits || a.idx - b.idx);
    const ws = apportion(
      rowItems.map((x) => creditWeight(x.course.credits)),
      totalCols,
      minW,
    );
    let x = 1;
    rowItems.forEach((it, i) => {
      map.set(it.course.id, { x, y: rowY, w: ws[i], h: 1 });
      x += ws[i];
    });
    rowY += 1;
    bandIdx += 1;
  }

  return { map, rows: rowY - 1, nextBandIdx: bandIdx };
}

/** 移动端（6 列）专用满幅拼版：大课 3x2 / 4x1 突出，中课 3x1 并排，小课 2x1/3x1 填缝，保证手机端可读性 */
export function solveMobilePacking(
  courses: AcademicCourse[],
  startBandIdx = 0,
): { map: Map<string, GridPlacement>; rows: number; nextBandIdx: number } {
  const map = new Map<string, GridPlacement>();
  if (courses.length === 0) return { map, rows: 0, nextBandIdx: startBandIdx };

  const pool = courses
    .map((course, idx) => ({ course, idx }))
    .sort((a, b) => b.course.credits - a.course.credits || a.idx - b.idx);

  let rowY = 1;
  let bandIdx = startBandIdx;

  while (pool.length > 0) {
    const n = pool.length;
    if (n >= 3 && pool[0].course.credits >= 3.5 && (n - 3 === 0 || n - 3 >= 2)) {
      const hero = pool.shift()!;
      const c1 = pool.pop()!;
      const c2 = pool.pop()!;
      const heroRight = bandIdx % 2 === 1;
      map.set(hero.course.id, { x: heroRight ? 4 : 1, y: rowY, w: 3, h: 2 });
      map.set(c1.course.id, { x: heroRight ? 1 : 4, y: rowY, w: 3, h: 1 });
      map.set(c2.course.id, { x: heroRight ? 1 : 4, y: rowY + 1, w: 3, h: 1 });
      rowY += 2;
      bandIdx += 1;
      continue;
    }

    if (n >= 2 && (pool[0].course.credits - pool[pool.length - 1].course.credits >= 1.5 || n === 2 || n === 4)) {
      const a = pool.shift()!;
      const b = pool.pop()!;
      const diff = a.course.credits - b.course.credits;
      const wA = diff >= 1.5 ? 4 : 3;
      const wB = 6 - wA;
      map.set(a.course.id, { x: 1, y: rowY, w: wA, h: 1 });
      map.set(b.course.id, { x: 1 + wA, y: rowY, w: wB, h: 1 });
      rowY += 1;
      bandIdx += 1;
      continue;
    }

    if (n === 1) {
      const only = pool.shift()!;
      map.set(only.course.id, { x: 1, y: rowY, w: 6, h: 1 });
      rowY += 1;
      bandIdx += 1;
      continue;
    }

    const take = n >= 3 ? 3 : n;
    const rowItems = pool.splice(0, take);
    const ws = apportion(
      rowItems.map((x) => creditWeight(x.course.credits)),
      6,
      2,
    );
    let x = 1;
    rowItems.forEach((it, i) => {
      map.set(it.course.id, { x, y: rowY, w: ws[i], h: 1 });
      x += ws[i];
    });
    rowY += 1;
    bandIdx += 1;
  }

  return { map, rows: rowY - 1, nextBandIdx: bandIdx };
}

function packWithMilestones(
  courses: AcademicCourse[],
  totalCols: number,
  solver: (regular: AcademicCourse[]) => { map: Map<string, GridPlacement>; rows: number; nextBandIdx: number },
) {
  const milestones = courses.filter((c) => c.kind === 'milestone');
  const regular = courses.filter((c) => c.kind !== 'milestone');
  const map = new Map<string, GridPlacement>();
  let yOffset = 0;

  for (const m of milestones) {
    const h = Math.max(2, m.milestoneSpan ?? 2);
    map.set(m.id, { x: 1, y: yOffset + 1, w: totalCols, h });
    yOffset += h;
  }

  const inner = solver(regular);
  for (const [id, g] of inner.map.entries()) {
    map.set(id, { ...g, y: g.y + yOffset });
  }

  return { map, rows: yOffset + inner.rows, nextBandIdx: inner.nextBandIdx };
}

const ROMAN_NUMERALS = ['', '\u2160', '\u2161', '\u2162', '\u2163', '\u2164', '\u2165', '\u2166', '\u2167', '\u2168', '\u2169'];

function toUnicodeRoman(n: number): string {
  return ROMAN_NUMERALS[n] || String(n);
}

function replaceTrailingNumber(text: string): string {
  return text.replace(/([^\dA-Za-z])\s*([1-9]|10)$/, (_, prev: string, num: string) => `${prev} ${toUnicodeRoman(Number(num))}`);
}

export function formatCourseTitle(rawName: string): { mainTitle: string; subTags: string[] } {
  const subTags: string[] = [];
  let main = '';
  let lastIndex = 0;
  const parenRe = /（([^）]+)）|\(([^)]+)\)/g;

  for (const m of rawName.matchAll(parenRe)) {
    const start = m.index ?? 0;
    const before = rawName.slice(lastIndex, start).trim();
    if (before) main += before;
    lastIndex = start + m[0].length;

    const inner = (m[1] ?? m[2] ?? '').trim();
    if (/^(?:[1-9]|10)$/.test(inner)) {
      main = `${main.trimEnd()} ${toUnicodeRoman(Number(inner))}`;
    } else if (inner) {
      subTags.push(replaceTrailingNumber(inner));
    }
  }

  const tail = rawName.slice(lastIndex).trim();
  if (tail) main += tail;
  const mainTitle = replaceTrailingNumber(main.trim()).replace(/\s+/g, ' ');
  return { mainTitle, subTags };
}

function computeTitleRem(
  course: AcademicCourse,
  placement: GridPlacement,
  cols: number,
  isDesktop: boolean,
  formatted: { mainTitle: string; subTags: string[] },
): number {
  if (course.kind === 'milestone') {
    return course.milestoneSpan && course.milestoneSpan >= 4 ? (isDesktop ? 3.1 : 2.1) : isDesktop ? 2.2 : 1.55;
  }
  const canvasW = isDesktop ? 1140 : 280;
  const isClin = course.track === 'clin';
  const rowPx = isClin ? (isDesktop ? 134 : 118) : (isDesktop ? 104 : 90);
  const availW = Math.max(72, (placement.w / cols) * canvasW - (isDesktop ? 30 : 18));
  const reserveV = (isDesktop ? 44 : 36) + (course.en ? (isDesktop ? 28 : 22) : 0) + (formatted.subTags.length > 0 ? 12 : 0);
  const availH = Math.max(38, placement.h * rowPx - reserveV);
  const strokeW = isClin ? 1.07 : 1.02;
  const visualLen = [...formatted.mainTitle].reduce(
    (s, ch) => s + (/[\x00-\xff]/.test(ch) ? 0.56 : /[\u2160-\u217f]/.test(ch) ? 0.85 : 1) * strokeW,
    0,
  );
  const singleLine = visualLen <= (isDesktop ? 5.2 : 4);
  const targetLines = placement.h >= 2 ? (visualLen > 8 ? 2.1 : 1.35) : singleLine ? 1 : 1.8;
  const charsPerLine = Math.max(1.6, visualLen / targetLines);
  const byW = (availW * 0.9) / charsPerLine;
  const byH = (availH * 0.86) / (targetLines * 1.15);
  const maxPx = placement.h >= 2 ? (isDesktop ? 36 : 23) : isDesktop ? (isClin ? 25 : 27) : 18;
  const minPx = isDesktop ? 12.5 : 11;
  const px = Math.max(minPx, Math.min(maxPx, byW, byH));
  return Number((px / 16).toFixed(2));
}

function compactAxisLabel(label: string) {
  return label
    .replace('大四学年 · ', '')
    .replace('大五学年 · ', '')
    .replace(' · 见习', '')
    .replace('与毕业考', '');
}

export function packAcademics(data: AcademicData): PackedSemester[] {
  const bySem = new Map<string, AcademicCourse[]>();
  for (const sem of data.semesters) bySem.set(sem.id, []);
  for (const c of data.courses) {
    const bucket = bySem.get(c.semesterId);
    if (bucket) bucket.push(c);
  }

  let dBand = 0;
  let tBand = 0;
  let mBand = 0;

  return data.semesters.map((sem) => {
    const list = bySem.get(sem.id) ?? [];
    const d = packWithMilestones(list, 24, (reg) => solveGridPacking(reg, 24, 3, dBand));
    const t = packWithMilestones(list, 12, (reg) => solveGridPacking(reg, 12, 3, tBand));
    const m = packWithMilestones(list, 6, (reg) => solveMobilePacking(reg, mBand));
    dBand = d.nextBandIdx;
    tBand = t.nextBandIdx;
    mBand = m.nextBandIdx;

    const packed: PackedCourse[] = list.map((course) => {
      const desktop = d.map.get(course.id) ?? { x: 1, y: 1, w: 24, h: 1 };
      const tablet = t.map.get(course.id) ?? { x: 1, y: 1, w: 12, h: 1 };
      const mobile = m.map.get(course.id) ?? { x: 1, y: 1, w: 6, h: 1 };
      const formatted = formatCourseTitle(course.name);
      return {
        ...course,
        hue: sem.hue,
        semesterLabel: sem.label,
        semesterYear: sem.year,
        mainTitle: formatted.mainTitle,
        subTags: formatted.subTags,
        titleRemD: computeTitleRem(course, desktop, 24, true, formatted),
        titleRemM: computeTitleRem(course, mobile, 6, false, formatted),
        desktop,
        tablet,
        mobile,
      };
    });

    const totalCredits = list.reduce((sum, c) => sum + c.credits, 0);
    const litCredits = list
      .filter((c) => c.status !== 'planned')
      .reduce((sum, c) => sum + c.credits, 0);

    return {
      ...sem,
      courses: packed,
      totalCredits,
      litCredits,
      desktopRows: d.rows,
      tabletRows: t.rows,
      mobileRows: m.rows,
    };
  });
}

/** 将同一轨道的多个学期在纵向上无间断拼接为单一连续网格，同时输出对齐各学段的纵坐标轴 */
export function packTrackWall(semesters: PackedSemester[]): PackedTrackWall {
  const courses: PackedCourse[] = [];
  const axis: AxisSegment[] = [];
  let dOff = 0;
  let tOff = 0;
  let mOff = 0;
  let prevYear = '';

  for (const sem of semesters) {
    const showYear = sem.year !== prevYear;
    prevYear = sem.year;
    axis.push({
      semesterId: sem.id,
      year: sem.year,
      shortYear: sem.year.replace(/20(\d\d)/g, '$1'),
      label: compactAxisLabel(sem.label),
      shortLabel: compactAxisLabel(sem.label).replace('医院', ''),
      showYear,
      hue: sem.hue,
      desktopRow: dOff + 1,
      desktopSpan: sem.desktopRows,
      tabletRow: tOff + 1,
      tabletSpan: sem.tabletRows,
      mobileRow: mOff + 1,
      mobileSpan: sem.mobileRows,
    });

    for (const c of sem.courses) {
      courses.push({
        ...c,
        desktop: { ...c.desktop, y: c.desktop.y + dOff },
        tablet: { ...c.tablet, y: c.tablet.y + tOff },
        mobile: { ...c.mobile, y: c.mobile.y + mOff },
      });
    }
    dOff += sem.desktopRows;
    tOff += sem.tabletRows;
    mOff += sem.mobileRows;
  }

  return {
    courses,
    axis,
    desktopRows: dOff,
    tabletRows: tOff,
    mobileRows: mOff,
  };
}

export function computeAcademicStats(data: AcademicData) {
  const creditCourses = data.courses.filter((c) => c.kind !== 'milestone');
  const milestones = data.courses.filter((c) => c.kind === 'milestone');
  const orig = creditCourses.filter((c) => c.track === 'orig');
  const clin = creditCourses.filter((c) => c.track === 'clin');
  const sumCr = (arr: AcademicCourse[]) => arr.reduce((s, c) => s + c.credits, 0);

  const completed = data.courses.filter((c) => c.status === 'completed');
  const active = data.courses.filter((c) => c.status === 'active');
  const planned = data.courses.filter((c) => c.status === 'planned');
  const early = data.courses.filter((c) => c.early);
  const clinLit = clin.filter((c) => c.status !== 'planned');

  return {
    totalTiles: data.courses.length,
    totalCourses: creditCourses.length,
    milestoneCount: milestones.length,
    totalCredits: sumCr(creditCourses),
    origCourses: orig.length,
    origCredits: sumCr(orig),
    clinCourses: clin.length,
    clinCredits: sumCr(clin),
    clinLitCourses: clinLit.length,
    clinLitCredits: sumCr(clinLit),
    completedCount: completed.length,
    completedCredits: sumCr(completed),
    activeCount: active.length,
    activeCredits: sumCr(active),
    earlyCount: early.length,
    earlyCredits: sumCr(early),
    plannedCount: planned.length,
    plannedCredits: sumCr(planned),
  };
}

export const fmtCredit = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
