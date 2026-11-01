// 拉取 OpenCode GO 的模型计价，落地成 src/data/opencode-go-pricing.json。
//
// 数据源：GET https://opencode.ai/zen/go/v1/models（公开，无需鉴权）
//   cost.text.input.price / cost.text.input.cache.read / cost.text.output.price
//   单位是 USD / 1M tokens；cost.multipliers 是峰时或生效日之后的倍率。
//
// 用法：node scripts/fetch-opencode-go-pricing.mjs
// 页面：src/pages/ai-quota/pricing.astro（构建时读 JSON，不发请求）

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/opencode-go-pricing.json');
const SOURCE = 'https://opencode.ai/zen/go/v1/models';

/** 供应商：展示名 + 图标 slug（public/logos/<slug>.svg） + 没有官方图标时的字母兜底 */
const VENDORS = {
  openai: { label: 'OpenAI', logo: 'openai' },
  anthropic: { label: 'Anthropic', logo: 'anthropic' },
  google: { label: 'Google', logo: 'googlegemini' },
  xai: { label: 'xAI', logo: 'x' },
  deepseek: { label: 'DeepSeek', logo: 'deepseek' },
  meta: { label: 'Meta', logo: 'meta' },
  alibaba: { label: '阿里通义', logo: 'qwen' },
  tencent: { label: '腾讯', logo: '', mark: 'T' },
  moonshotai: { label: '月之暗面', logo: 'moonshotai' },
  xiaomi: { label: '小米', logo: 'xiaomi' },
  minimax: { label: 'MiniMax', logo: 'minimax' },
  meituan: { label: '美团', logo: 'meituan' },
  stepfun: { label: '阶跃星辰', logo: '', mark: 'S' },
  reflection: { label: 'Reflection', logo: '', mark: 'R' },
  zhipuai: { label: '智谱', logo: '', mark: 'G' },
};

const vendorOf = (canonicalId) => String(canonicalId || '').split('/')[0] || 'other';

/** 倍率说明：把 when 结构翻译成一句人话，读不懂就只报倍率本身 */
function describeMultiplier(multiplier) {
  if (!multiplier || typeof multiplier !== 'object') return null;
  const factor = Number(multiplier.factor);
  if (!Number.isFinite(factor) || factor === 1) return null;
  const when = multiplier.when || {};

  const clock = (value) => String(value || '').slice(0, 5);
  /** 一个 all[] 里的 gte/lt 是同一个区间的两端，必须合并，不能各算各的 */
  const windowOf = (group) => {
    if (!Array.isArray(group)) return null;
    let lower = '';
    let upper = '';
    for (const node of group) {
      const hours = node && node.utc_hours;
      if (!hours) continue;
      if (!lower && hours.gte) lower = clock(hours.gte);
      if (!upper && hours.lt) upper = clock(hours.lt);
    }
    if (!lower && !upper) return null;
    return `${lower || '00:00'}–${upper || '24:00'}`;
  };

  const windows = [];
  const collect = (node) => {
    if (!node || typeof node !== 'object') return;
    // { any: [ { all: [...] }, ... ] } 或直接的 { all: [...] }
    if (Array.isArray(node.any)) node.any.forEach((branch) => collect(branch));
    if (Array.isArray(node.all)) {
      const range = windowOf(node.all);
      if (range) windows.push(range);
      else node.all.forEach(collect);
    }
  };
  collect(when);

  if (when.date && when.date.gte) {
    return `${String(when.date.gte).slice(0, 10)} 起 ×${factor}`;
  }
  if (windows.length) {
    return `工作日 ${windows.join(' / ')} UTC ×${factor}`;
  }
  return `特定时段 ×${factor}`;
}

const response = await fetch(SOURCE, { headers: { accept: 'application/json', 'user-agent': 'acretiondisk-blog/quota-pricing' } });
if (!response.ok) {
  throw new Error(`上游返回 HTTP ${response.status}`);
}
const payload = await response.json();
const models = (Array.isArray(payload.data) ? payload.data : [])
  .map((model) => {
    const text = (model.cost && model.cost.text) || {};
    const input = text.input || {};
    const output = text.output || {};
    const vendor = vendorOf(model.canonical_id);
    const meta = VENDORS[vendor] || { label: '—', logo: '', mark: '·' };
    const multipliers = Array.isArray(model.cost && model.cost.multipliers) ? model.cost.multipliers : [];
    const notes = multipliers.map(describeMultiplier).filter(Boolean);
    return {
      id: model.id,
      name: model.name || model.id,
      vendor,
      vendorLabel: meta.label,
      logo: meta.logo || '',
      mark: meta.mark || '',
      input: Number(input.price) || 0,
      output: Number(output.price) || 0,
      cacheRead: Number(input.cache && input.cache.read) || 0,
      context: Number(model.limit && model.limit.context) || 0,
      note: notes.length ? notes.join('；') : null,
    };
  })
  .filter((model) => model.name)
  .sort((a, b) => b.output - a.output || b.input - a.input);

const out = {
  source: SOURCE,
  unit: 'USD',
  perTokens: 1_000_000,
  fetchedAt: new Date().toISOString(),
  models,
};

await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`写入 ${OUT}：${models.length} 个模型，输出价 ${models[0].output} – ${models[models.length - 1].output}`);
