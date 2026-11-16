/**
 * 桌面版启动日志。
 *
 * 目的：打包后的 GUI 程序双击后如果出错，控制台是看不到的，用户只会看到"没反应"。
 * 因此主进程从第一行代码起就把关键步骤写进日志文件，出问题时有据可查。
 *
 * 日志位置：%APPDATA%\ACR-BLOG\logs\main.log（不可写时退回 exe 同目录的 logs\）。
 * 这个模块绝不抛异常，写日志失败也不能影响启动。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

let cachedPath;

/** 依次尝试的日志目录 */
function candidates() {
  const list = [];
  if (process.env.APPDATA) list.push(join(process.env.APPDATA, 'ACR-BLOG', 'logs'));
  try { list.push(join(dirname(process.execPath), 'logs')); } catch { /* 忽略 */ }
  if (process.env.TEMP) list.push(join(process.env.TEMP, 'ACR-BLOG-logs'));
  if (process.env.TMP) list.push(join(process.env.TMP, 'ACR-BLOG-logs'));
  return list;
}

/** 找到第一个可写的日志文件；都不行返回空字符串 */
export function logFilePath() {
  if (cachedPath !== undefined) return cachedPath;
  for (const dir of candidates()) {
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'main.log');
      // 超过上限时轮转一次，避免无限增长
      try {
        if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      } catch { /* 文件还不存在 */ }
      appendFileSync(file, '');
      cachedPath = file;
      return cachedPath;
    } catch { /* 试下一个目录 */ }
  }
  cachedPath = '';
  return cachedPath;
}

/** 写一行日志（带 ISO 时间戳），同时尝试输出到 stdout */
export function log(...parts) {
  const text = parts
    .map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  const line = `[${new Date().toISOString()}] ${text}\n`;
  const file = logFilePath();
  if (file) {
    try { appendFileSync(file, line); } catch { /* 忽略 */ }
  }
  try { process.stdout.write(line); } catch { /* 忽略 */ }
  return line;
}

/** 记录一个异常对象，附上上下文标签 */
export function logError(label, err) {
  if (err instanceof Error) {
    log(`${label}: ${err.name}: ${err.message}`);
    if (err.stack) log(`  堆栈:\n${err.stack}`);
  } else {
    log(`${label}:`, err);
  }
}

/** 清空日志（仅在用户主动重置时使用） */
export function resetLog() {
  const file = logFilePath();
  if (!file) return;
  try { writeFileSync(file, ''); } catch { /* 忽略 */ }
}

/** 读取最近若干行日志，用于「关于」/错误页展示 */
export function tailLog(lines = 40) {
  const file = logFilePath();
  if (!file) return '';
  try {
    const all = readFileSync(file, 'utf8').trimEnd().split('\n');
    return all.slice(-lines).join('\n');
  } catch {
    return '';
  }
}
