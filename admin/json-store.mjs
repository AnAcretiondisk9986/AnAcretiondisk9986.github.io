/**
 * JSON 配置存储：原子写入 + 结构校验 + 轮换备份 + 内容哈希冲突检测。
 *
 * 用途：画廊 / 关于 / 前端定制 / 访问控制等 JSON 数据源。
 * 设计原则：
 * - 写入前先校验结构，校验失败不触碰磁盘（非法数据不会覆盖有效文件）。
 * - 用临时文件 + rename 原子替换，写入中断不会留下半写 JSON。
 * - 覆盖前先备份到 backupDir，便于误改后回滚。
 * - 读取返回 contentHash，写入可携带 expectedHash；不一致时抛 VersionConflictError。
 */
import { copyFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { atomicWriteFile, sha256 } from './atomic-file.mjs';

export class VersionConflictError extends Error {
  constructor(message, currentHash) {
    super(message);
    this.name = 'VersionConflictError';
    this.currentHash = currentHash;
  }
}

export class InvalidDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidDataError';
  }
}

export function serializeJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const HASH_RE = /^[a-f0-9]{64}$/;

/** 校验客户端传入的哈希：返回 { missing } | { invalid } | { hash } */
export function parseExpectedHash(value) {
  if (value === undefined || value === null) return { missing: true };
  const raw = String(value).trim().toLowerCase();
  if (raw === '') return { hash: '' };
  if (!HASH_RE.test(raw)) return { invalid: true };
  return { hash: raw };
}

export function createJsonStore({
  filePath,
  label = basename(filePath),
  readDefault = () => ({}),
  validate = null,
  backupDir = null,
  maxBackups = 10,
} = {}) {
  if (!filePath) throw new Error('createJsonStore 需要 filePath');

  async function readRaw() {
    try {
      return await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function read() {
    const raw = await readRaw();
    if (raw === null) return { data: readDefault(), contentHash: null, exists: false };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new InvalidDataError(`${label} 文件不是合法 JSON：${err.message}`);
    }
    return { data: parsed, contentHash: sha256(raw), exists: true };
  }

  async function pruneBackups() {
    if (!backupDir) return;
    try {
      const entries = (await readdir(backupDir)).filter((name) => name.startsWith(`${label}.`)).sort();
      const excess = entries.length - maxBackups;
      for (let i = 0; i < excess; i += 1) {
        await unlink(join(backupDir, entries[i])).catch(() => {});
      }
    } catch { /* 备份轮换失败不影响写入 */ }
  }

  async function backupCurrent() {
    if (!backupDir) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(backupDir, `${label}.${stamp}.json`);
    try {
      await mkdir(backupDir, { recursive: true });
      await copyFile(filePath, target);
      await pruneBackups();
      return target;
    } catch {
      return null;
    }
  }

  /**
   * 写入 JSON（同一 store 内的写入串行执行，避免并发覆盖）。
   * @param {*} data 待写入数据（会经过 validate 校验/规范化）
   * @param {object} [options]
   * @param {string|null} [options.expectedHash] 客户端读取到的 contentHash；不一致时抛 VersionConflictError
   */
  async function performWrite(data, { expectedHash = null } = {}) {
    const normalized = validate ? validate(data) : data;
    const currentRaw = await readRaw();
    const currentHash = currentRaw === null ? null : sha256(currentRaw);
    if (expectedHash !== null && String(expectedHash) !== String(currentHash ?? '')) {
      throw new VersionConflictError(`${label} 已被其他来源修改，请刷新后再保存`, currentHash);
    }
    if (currentRaw !== null) await backupCurrent();
    const text = serializeJson(normalized);
    await atomicWriteFile(filePath, text);
    return { data: normalized, contentHash: sha256(text) };
  }

  let writeQueue = Promise.resolve();
  function write(data, options) {
    const result = writeQueue.then(() => performWrite(data, options), () => performWrite(data, options));
    writeQueue = result.catch(() => {});
    return result;
  }

  return { filePath, label, read, write };
}
