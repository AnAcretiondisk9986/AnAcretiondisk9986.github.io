/**
 * 面向多设备协作的三方 JSON 数组语义合并器（按条目 id 合并）。
 *
 * 解决的问题：
 * - 手机端（/write/）与电脑端管理面板都会往 src/data/daily.json、src/data/gallery.json
 *   等 JSON 数组顶部插入新条目；普通 Git 按行合并几乎必然在文件头部冲突。
 * - 本模块以共同祖先（base）+ 本地（local）+ 远端（remote）三方对比，按 id 语义合并：
 *   1. 两端各自新增的不同条目全部保留；
 *   2. 两端各自删除的条目按删除意图移除（若一端删除、另一端修改，则报冲突不静默丢弃）；
 *   3. 同一旧条目若两端改了不同字段，做字段级三方合并；改了同一字段为不同值则报冲突；
 *   4. 若两端离线同时新增了相同 id 的不同条目（例如同日首条 daily-YYYYMMDD-01），
 *      保留已发布的远端 id，为本地新条目自动重分配下一个空闲 id，确保零丢失且不破坏线上链接。
 */
import { createMomentId, sortDailyItems } from '../src/lib/daily-moments-grid.mjs';

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function canonicalize(val) {
  if (Array.isArray(val)) return val.map(canonicalize);
  if (isPlainObject(val)) {
    const out = {};
    for (const k of Object.keys(val).sort()) {
      out[k] = canonicalize(val[k]);
    }
    return out;
  }
  return val;
}

function jsonEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function parseIdArray(raw, { allowEmpty = false } = {}) {
  if (raw == null || String(raw).trim() === '') {
    return allowEmpty ? { ok: true, items: [] } : { ok: false, reason: 'empty' };
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    return { ok: false, reason: 'invalid-json', message: err.message };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'not-array' };
  }
  const seen = new Set();
  for (const item of parsed) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
      return { ok: false, reason: 'missing-id' };
    }
    if (seen.has(item.id)) {
      return { ok: false, reason: 'duplicate-id', id: item.id };
    }
    seen.add(item.id);
  }
  return { ok: true, items: parsed };
}

function mergeObjectThreeWay(baseObj, localObj, remoteObj) {
  const keys = [];
  const seen = new Set();
  for (const src of [remoteObj, localObj, baseObj]) {
    for (const k of Object.keys(src)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const merged = {};
  for (const k of keys) {
    const hasB = Object.prototype.hasOwnProperty.call(baseObj, k);
    const hasL = Object.prototype.hasOwnProperty.call(localObj, k);
    const hasR = Object.prototype.hasOwnProperty.call(remoteObj, k);
    const sameBL = hasB === hasL && (!hasB || jsonEqual(baseObj[k], localObj[k]));
    const sameBR = hasB === hasR && (!hasB || jsonEqual(baseObj[k], remoteObj[k]));
    const sameLR = hasL === hasR && (!hasL || jsonEqual(localObj[k], remoteObj[k]));

    if (sameLR) {
      if (hasL) merged[k] = localObj[k];
    } else if (sameBL) {
      if (hasR) merged[k] = remoteObj[k];
    } else if (sameBR) {
      if (hasL) merged[k] = localObj[k];
    } else {
      return { ok: false, conflictedKey: k };
    }
  }
  return { ok: true, value: merged };
}

/**
 * 三方合并以 id 为主键的 JSON 数组。
 * @param {object} params
 * @param {string|null|undefined} params.baseText 共同祖先文件内容（可空，视为 []）
 * @param {string} params.localText 本地版本文件内容
 * @param {string} params.remoteText 远端版本文件内容
 * @param {(items: object[]) => object[]} [params.sort] 可选：最终排序函数
 * @param {(localItem: object, currentItems: object[]) => string} [params.rekeyOnAddCollision] 可选：两端新增同 id 时的重编号策略
 */
export function mergeJsonArrayById({
  baseText = '[]',
  localText,
  remoteText,
  sort = null,
  rekeyOnAddCollision = null,
} = {}) {
  const parsedBase = parseIdArray(baseText, { allowEmpty: true });
  const parsedLocal = parseIdArray(localText);
  const parsedRemote = parseIdArray(remoteText);
  if (!parsedBase.ok || !parsedLocal.ok || !parsedRemote.ok) {
    return {
      ok: false,
      reason: 'invalid-shape',
      conflictedIds: [],
      message: 'JSON 结构不符合按 id 合并的条件',
    };
  }

  const baseMap = new Map(parsedBase.items.map((item) => [item.id, item]));
  const localMap = new Map(parsedLocal.items.map((item) => [item.id, item]));
  const remoteMap = new Map(parsedRemote.items.map((item) => [item.id, item]));

  const addedLocal = [];
  const addedRemote = [];
  const collisionPairs = [];
  const survivingById = new Map();
  const conflictedIds = [];
  let mergedItems = 0;

  // 1. 先处理 base 中已存在的旧条目
  for (const [id, bItem] of baseMap) {
    const lItem = localMap.get(id);
    const rItem = remoteMap.get(id);
    if (!lItem && !rItem) continue; // 两端均删除
    if (!lItem && rItem) {
      if (jsonEqual(bItem, rItem)) continue; // 本地删除、远端未改 → 尊重删除
      conflictedIds.push(id); // 本地删除、远端修改 → 真冲突
      continue;
    }
    if (lItem && !rItem) {
      if (jsonEqual(bItem, lItem)) continue; // 远端删除、本地未改 → 尊重删除
      conflictedIds.push(id); // 远端删除、本地修改 → 真冲突
      continue;
    }
    // 两端均保留
    if (jsonEqual(lItem, rItem) || jsonEqual(bItem, rItem)) {
      survivingById.set(id, lItem);
    } else if (jsonEqual(bItem, lItem)) {
      survivingById.set(id, rItem);
    } else {
      const merged = mergeObjectThreeWay(bItem, lItem, rItem);
      if (!merged.ok) {
        conflictedIds.push(id);
      } else {
        survivingById.set(id, merged.value);
        mergedItems += 1;
      }
    }
  }

  // 2. 处理新增条目（不在 base 中）
  for (const item of parsedLocal.items) {
    if (baseMap.has(item.id)) continue;
    const rItem = remoteMap.get(item.id);
    if (!rItem) {
      addedLocal.push(item);
    } else if (jsonEqual(item, rItem)) {
      // 两端新增完全相同，只保留一份（归入远端新增分支避免重复）
    } else if (typeof rekeyOnAddCollision === 'function') {
      collisionPairs.push({ localItem: item, remoteItem: rItem });
    } else {
      conflictedIds.push(item.id);
    }
  }

  for (const item of parsedRemote.items) {
    if (baseMap.has(item.id)) continue;
    addedRemote.push(item);
  }

  if (conflictedIds.length > 0) {
    return {
      ok: false,
      reason: 'item-conflict',
      conflictedIds,
      message: `同一条目存在并发修改冲突：${conflictedIds.join(', ')}`,
    };
  }

  // 3. 按远端顺序拼回存活旧条目，前面放两端新增
  const survivingOrdered = [];
  for (const item of parsedRemote.items) {
    if (survivingById.has(item.id)) {
      survivingOrdered.push(survivingById.get(item.id));
      survivingById.delete(item.id);
    }
  }
  for (const item of parsedLocal.items) {
    if (survivingById.has(item.id)) {
      survivingOrdered.push(survivingById.get(item.id));
      survivingById.delete(item.id);
    }
  }

  // 4. 为同 id 并发新增的本地条目分配新 id（远端已发布 id 保持不变）
  const rekeyedIds = [];
  const combinedBeforeRekey = [...addedLocal, ...addedRemote, ...survivingOrdered];
  const rekeyedLocal = [];
  for (const { localItem } of collisionPairs) {
    const newId = rekeyOnAddCollision(localItem, [...combinedBeforeRekey, ...rekeyedLocal]);
    if (!newId || typeof newId !== 'string') {
      return {
        ok: false,
        reason: 'rekey-failed',
        conflictedIds: [localItem.id],
        message: `无法为并发新增条目 ${localItem.id} 分配新 id`,
      };
    }
    rekeyedIds.push({ from: localItem.id, to: newId });
    rekeyedLocal.push({ ...localItem, id: newId });
  }

  let result = [...addedLocal, ...rekeyedLocal, ...addedRemote, ...survivingOrdered];
  if (typeof sort === 'function') {
    result = sort(result);
  }

  return {
    ok: true,
    items: result,
    text: `${JSON.stringify(result, null, 2)}\n`,
    stats: {
      addedLocal: addedLocal.length + rekeyedLocal.length,
      addedRemote: addedRemote.length,
      mergedItems,
      rekeyedIds,
    },
  };
}

/** 博客内置支持的按 id 语义合并 JSON 文件规则 */
export const BLOG_JSON_MERGE_RULES = Object.freeze({
  'src/data/daily.json': Object.freeze({
    label: '日常数据',
    sort: sortDailyItems,
    rekeyOnAddCollision: (item, existing) => createMomentId(existing, item?.createdAt || ''),
  }),
  'src/data/gallery.json': Object.freeze({
    label: '画廊数据',
    rekeyOnAddCollision: (item, existing) => {
      const used = new Set((existing || []).map((e) => e?.id).filter(Boolean));
      let seq = 2;
      let candidate = `${item.id}-${seq}`;
      while (used.has(candidate)) {
        seq += 1;
        candidate = `${item.id}-${seq}`;
      }
      return candidate;
    },
  }),
});

export function normalizeRepoPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function getJsonMergeRule(filePath, rules = BLOG_JSON_MERGE_RULES) {
  if (!rules) return null;
  return rules[normalizeRepoPath(filePath)] || null;
}

/** 若文件路径命中语义合并规则则执行三方合并，否则返回 null */
export function tryMergeKnownJsonFile(filePath, { baseText, localText, remoteText, rules = BLOG_JSON_MERGE_RULES } = {}) {
  const rule = getJsonMergeRule(filePath, rules);
  if (!rule) return null;
  return mergeJsonArrayById({
    baseText,
    localText,
    remoteText,
    sort: rule.sort,
    rekeyOnAddCollision: rule.rekeyOnAddCollision,
  });
}
