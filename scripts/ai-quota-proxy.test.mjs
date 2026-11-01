// AI 额度代理契约测试（node:test，注入假 fetch，不联网）
// 覆盖：全部成功 / 单点 401 / 超时 / 缺 key / 缓存命中与 force / 密钥不泄漏 / ToolCode 回落。

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createQuotaService } from './ai-quota-proxy.mjs';

const EXPECTED_IDS = ['opencode-go', 'yundu', 'toolcode', 'taffcloud', 'deepseek', 'glm'];

const KEYS = {
  'opencode-go': { apiKey: 'oc_sk_TEST_openode_0001' },
  yundu: { apiKey: 'sk-TEST-yundu-0002' },
  toolcode: { apiKey: 'sk-TEST-toolcode-0003' },
  taffcloud: { apiKey: 'sk-TEST-taffcloud-0004', accessToken: '', userId: '' },
  deepseek: { apiKey: 'sk-TEST-deepseek-0005' },
  glm: { apiKey: '' },
};

const SECRET_VALUES = Object.values(KEYS)
  .map((entry) => entry.apiKey)
  .filter(Boolean);

const OPENCODE_BODY = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-11-01T12:33:25.000Z' },
    weekly: { status: 'ok', percent: 0, resetsAt: '2026-11-02T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 0, resetsAt: '2026-12-01T07:24:37.000Z' },
  },
};

const WALLET_BODY = {
  balance: 8.04656557,
  isValid: true,
  mode: 'unrestricted',
  planName: '钱包余额',
  remaining: 8.04656557,
  unit: 'USD',
  daily_usage: [
    {
      date: '2026-10-31',
      requests: 12,
      cost: 0.9,
      actual_cost: 0.31,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 150,
    },
    {
      date: '2026-11-01',
      requests: 59,
      cost: 4.3809838,
      actual_cost: 1.2179134964,
      input_tokens: 1417203,
      output_tokens: 60211,
      cache_read_tokens: 3685193,
      cache_write_tokens: 0,
      total_tokens: 5162607,
    },
  ],
  usage: {
    today: { requests: 59, cost: 4.3809838, actual_cost: 1.2179134964 },
    total: { requests: 1307, cost: 146.5957495, actual_cost: 31.358719441 },
  },
  model_stats: [{ model: 'gpt-6.1-sol', requests: 908 }],
};

const TAFF_SUB = { object: 'billing_subscription', hard_limit_usd: 100000000, soft_limit_usd: 100000000 };
const TAFF_USAGE = { object: 'list', total_usage: 104.59039999999999 };

const DEEPSEEK_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '13.16', granted_balance: '0.00', topped_up_balance: '13.16' },
  ],
};

let tempDir = null;
afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function writeKeysFile(keys) {
  tempDir = await mkdtemp(join(tmpdir(), 'ai-quota-proxy-'));
  const file = join(tempDir, 'keys.json');
  await writeFile(file, JSON.stringify(keys, null, 2), 'utf8');
  return file;
}

/** 假 fetch：rules = [[匹配串或正则, { status, body } | 函数]，首个匹配生效。 */
function makeFetch(rules) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const target = String(url);
    const headers = init.headers || {};
    calls.push({ url: target, headers });
    const rule = rules.find(([matcher]) =>
      typeof matcher === 'string' ? target.startsWith(matcher) : matcher.test(target),
    );
    if (!rule) throw new Error(`未预期的上游请求：${target}`);
    const reply = typeof rule[1] === 'function' ? await rule[1](target, headers, calls) : rule[1];
    if (reply && reply.throwError) {
      const error = new Error(reply.throwError);
      error.name = reply.throwName || 'Error';
      throw error;
    }
    const status = reply.status == null ? 200 : reply.status;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (reply.body == null ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
    };
  };
  impl.calls = calls;
  impl.countOf = (prefix) => calls.filter((call) => call.url.startsWith(prefix)).length;
  return impl;
}

function successRules() {
  return [
    ['https://opencode.ai/zen/go/v1/usage', { body: OPENCODE_BODY }],
    ['https://gd.yundu.lol/v1/usage', { body: WALLET_BODY }],
    ['https://toolcode.cc/v1/usage', { body: { ...WALLET_BODY, balance: 5.19845143 } }],
    ['https://api.taffcloud.xyz/v1/dashboard/billing/subscription', { body: TAFF_SUB }],
    ['https://api.taffcloud.xyz/v1/dashboard/billing/usage', { body: TAFF_USAGE }],
    ['https://api.deepseek.com/user/balance', { body: DEEPSEEK_BODY }],
  ];
}

async function buildService({ rules = successRules(), keys = KEYS, ...options } = {}) {
  const keysFile = await writeKeysFile(keys);
  const fetchImpl = makeFetch(rules);
  const service = createQuotaService({
    keysFile,
    fetchImpl,
    env: {},
    retryDelayMs: 0,
    ...options,
  });
  return { service, fetchImpl, keysFile };
}

function assertProviderShape(provider) {
  for (const field of [
    'id',
    'label',
    'group',
    'status',
    'message',
    'updatedAt',
    'currency',
    'balance',
    'quota',
    'windows',
    'usage',
    'series',
    'meta',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(provider, field), `缺少字段 ${field}`);
  }
  assert.ok(typeof provider.id === 'string');
  assert.ok(typeof provider.label === 'string');
  assert.ok(['subscription', 'relay', 'platform'].includes(provider.group));
  assert.ok(
    ['ok', 'missing-key', 'auth', 'network', 'timeout', 'upstream', 'config-error'].includes(provider.status),
    `未知状态 ${provider.status}`,
  );
  assert.ok(provider.message === null || typeof provider.message === 'string');
  assert.ok(!Number.isNaN(Date.parse(provider.updatedAt)), 'updatedAt 必须是 ISO 时间');
  assert.ok(provider.currency === null || ['USD', 'CNY'].includes(provider.currency));
  assert.ok(provider.balance === null || typeof provider.balance === 'number');
  assert.ok(provider.meta !== null && typeof provider.meta === 'object' && !Array.isArray(provider.meta));
}

function providerOf(payload, id) {
  const found = payload.providers.find((provider) => provider.id === id);
  assert.ok(found, `缺少 provider ${id}`);
  return found;
}

test('六个上游全部成功时返回完整契约数据', async () => {
  const { service } = await buildService();
  const payload = await service.readAll();

  assert.equal(payload.ok, true);
  assert.equal(payload.cacheSeconds, 30);
  assert.ok(!Number.isNaN(Date.parse(payload.generatedAt)));
  assert.deepEqual(
    payload.providers.map((provider) => provider.id),
    EXPECTED_IDS,
  );
  payload.providers.forEach(assertProviderShape);

  const opencode = providerOf(payload, 'opencode-go');
  assert.equal(opencode.group, 'subscription');
  assert.equal(opencode.status, 'ok');
  assert.equal(opencode.windows.length, 3);
  assert.deepEqual(
    opencode.windows.map((window) => window.key),
    ['rolling', 'weekly', 'monthly'],
  );
  assert.deepEqual(
    opencode.windows.map((window) => window.label),
    ['滚动 5 小时', '每周', '每月'],
  );
  assert.deepEqual(
    opencode.windows.map((window) => window.percent),
    [0, 0, 0],
  );
  assert.equal(opencode.windows[0].resetsAt, '2026-11-01T12:33:25.000Z');
  assert.equal(opencode.windows[0].status, 'ok');

  const yundu = providerOf(payload, 'yundu');
  assert.equal(yundu.status, 'ok');
  assert.equal(yundu.currency, 'USD');
  assert.equal(yundu.balance, 8.04656557);
  assert.equal(yundu.usage.todayRequests, 59);
  assert.equal(yundu.usage.todayCost, 1.2179134964);
  assert.equal(yundu.usage.totalCost, 31.358719441);
  assert.equal(yundu.usage.isValid, true);
  assert.equal(yundu.usage.mode, 'unrestricted');
  assert.deepEqual(yundu.series, [
    { date: '2026-10-31', cost: 0.31, requests: 12 },
    { date: '2026-11-01', cost: 1.2179134964, requests: 59 },
  ]);

  const toolcode = providerOf(payload, 'toolcode');
  assert.equal(toolcode.status, 'ok');
  assert.equal(toolcode.balance, 5.19845143);
  assert.equal(toolcode.meta.host, 'toolcode.cc');

  const taffcloud = providerOf(payload, 'taffcloud');
  assert.equal(taffcloud.status, 'ok');
  assert.equal(taffcloud.currency, 'USD');
  assert.equal(taffcloud.balance, null);
  assert.deepEqual(taffcloud.quota, {
    unlimited: true,
    limit: null,
    used: 1.045904,
    remaining: null,
  });
  assert.equal(taffcloud.meta.mode, 'billing');
  assert.equal(taffcloud.meta.hardLimitUsd, 100000000);

  const deepseek = providerOf(payload, 'deepseek');
  assert.equal(deepseek.status, 'ok');
  assert.equal(deepseek.currency, 'CNY');
  assert.equal(deepseek.balance, 13.16);
  assert.equal(deepseek.usage.isValid, true);

  const glm = providerOf(payload, 'glm');
  assert.equal(glm.status, 'missing-key');
  assert.equal(glm.balance, null);
  assert.ok(glm.message.includes('未配置'));
});

test('单个上游 401 只影响自己，其余照常返回', async () => {
  const rules = successRules().map(([matcher, reply]) =>
    matcher === 'https://gd.yundu.lol/v1/usage'
      ? [matcher, { status: 401, body: { type: 'error', error: { type: 'AuthError' } } }]
      : [matcher, reply],
  );
  const { service } = await buildService({ rules });
  const payload = await service.readAll();

  assert.equal(payload.ok, true);
  const yundu = providerOf(payload, 'yundu');
  assert.equal(yundu.status, 'auth');
  assert.equal(yundu.message, 'API Key 无效或已失效');
  assert.equal(yundu.balance, null);
  assert.equal(providerOf(payload, 'deepseek').status, 'ok');
  assert.equal(providerOf(payload, 'taffcloud').status, 'ok');
  assert.equal(providerOf(payload, 'opencode-go').status, 'ok');
});

test('上游超时归为 timeout，不拖垮其它 provider', async () => {
  const rules = successRules().map(([matcher, reply]) =>
    matcher === 'https://api.deepseek.com/user/balance'
      ? [
          matcher,
          { throwError: 'The operation was aborted due to timeout', throwName: 'TimeoutError' },
        ]
      : [matcher, reply],
  );
  const { service } = await buildService({ rules });
  const payload = await service.readAll();

  const deepseek = providerOf(payload, 'deepseek');
  assert.equal(deepseek.status, 'timeout');
  assert.ok(deepseek.message.includes('超时'));
  assert.equal(providerOf(payload, 'yundu').status, 'ok');
  assert.equal(providerOf(payload, 'glm').status, 'missing-key');
});

test('密钥为空时优雅降级为 missing-key，且完全不发请求', async () => {
  const emptyKeys = Object.fromEntries(Object.keys(KEYS).map((id) => [id, { apiKey: '' }]));
  const { service, fetchImpl } = await buildService({ keys: emptyKeys });
  const payload = await service.readAll();

  assert.equal(payload.ok, true);
  assert.equal(fetchImpl.calls.length, 0);
  for (const provider of payload.providers) {
    assert.equal(provider.status, 'missing-key');
    assert.equal(provider.balance, null);
    assert.equal(provider.currency, null);
  }
});

test('30s 缓存命中不发请求，force=1 与过期后均回源', async () => {
  let clock = Date.parse('2026-11-01T07:45:00.000Z');
  const { service, fetchImpl } = await buildService({ now: () => clock });

  const first = await service.readAll();
  const callsAfterFirst = fetchImpl.calls.length;
  assert.ok(callsAfterFirst > 0);

  const cached = await service.readAll();
  assert.equal(fetchImpl.calls.length, callsAfterFirst, '缓存命中时不应再访问上游');
  assert.equal(cached.generatedAt, first.generatedAt);
  assert.deepEqual(cached, first);

  clock += 31_000;
  const expired = await service.readAll();
  assert.ok(fetchImpl.calls.length > callsAfterFirst, '超过 30s 应回源');
  assert.notEqual(expired.generatedAt, first.generatedAt);

  const callsBeforeForce = fetchImpl.calls.length;
  const forced = await service.readAll({ force: true });
  assert.ok(fetchImpl.calls.length > callsBeforeForce, 'force 应绕过缓存');
  assert.equal(forced.generatedAt, expired.generatedAt);
});

test('ttlMs:0 时永不走缓存', async () => {
  const { service, fetchImpl } = await buildService({ ttlMs: 0 });
  await service.readAll();
  const callsAfterFirst = fetchImpl.calls.length;
  await service.readAll();
  assert.ok(fetchImpl.calls.length > callsAfterFirst);
});

test('返回值与错误信息里都不出现密钥', async () => {
  const { service } = await buildService();
  const payload = await service.readAll();
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes('sk-'), '序列化结果不得包含 sk- 形式的密钥');
  assert.ok(!serialized.includes('oc_sk'), '序列化结果不得包含 opencode-go 密钥');
  for (const secret of SECRET_VALUES) {
    assert.ok(!serialized.includes(secret), '序列化结果不得包含具体密钥值');
  }

  for (const provider of payload.providers) {
    if (provider.message) {
      assert.ok(!provider.message.includes('sk-'), '错误 message 不得包含密钥');
      assert.ok(!/Bearer/i.test(provider.message), '错误 message 不得包含 Authorization 头');
    }
  }
});

test('ToolCode：.cc 非 2xx 后回落 .top', async () => {
  const rules = successRules().map(([matcher, reply]) =>
    matcher === 'https://toolcode.cc/v1/usage' ? [matcher, { status: 500, body: 'edge error' }] : [matcher, reply],
  );
  const topRule = ['https://toolcode.top/v1/usage', { body: { ...WALLET_BODY, balance: 5.19845143 } }];
  rules.push(topRule);

  const { service, fetchImpl } = await buildService({ rules });
  const payload = await service.readAll();

  const toolcode = providerOf(payload, 'toolcode');
  assert.equal(toolcode.status, 'ok');
  assert.equal(toolcode.balance, 5.19845143);
  assert.equal(toolcode.meta.host, 'toolcode.top');
  assert.equal(toolcode.meta.retried, true);
  assert.equal(fetchImpl.countOf('https://toolcode.cc/v1/usage'), 2, '.cc 应重试一次');
  assert.equal(fetchImpl.countOf('https://toolcode.top/v1/usage'), 1);
});

test('ToolCode：首包 401（边缘缓存）后重试同一域名即成功', async () => {
  let ccHits = 0;
  const rules = successRules().map(([matcher, reply]) =>
    matcher === 'https://toolcode.cc/v1/usage'
      ? [
          matcher,
          () => {
            ccHits += 1;
            if (ccHits === 1) return { status: 401, body: { type: 'error' } };
            return { body: { ...WALLET_BODY, balance: 5.19845143 } };
          },
        ]
      : [matcher, reply],
  );

  const { service, fetchImpl } = await buildService({ rules });
  const payload = await service.readAll();

  const toolcode = providerOf(payload, 'toolcode');
  assert.equal(toolcode.status, 'ok');
  assert.equal(toolcode.meta.host, 'toolcode.cc');
  assert.equal(toolcode.meta.retried, true);
  assert.equal(fetchImpl.countOf('https://toolcode.cc/v1/usage'), 2);
  assert.equal(fetchImpl.countOf('https://toolcode.top/v1/usage'), 0);
});

test('密钥文件损坏时 ok:false，全部 provider 标 config-error', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ai-quota-proxy-'));
  const brokenFile = join(tempDir, 'keys.json');
  await writeFile(brokenFile, '{ this is not json', 'utf8');
  const fetchImpl = makeFetch([]);
  const service = createQuotaService({ keysFile: brokenFile, fetchImpl, env: {}, retryDelayMs: 0 });

  const payload = await service.readAll();
  assert.equal(payload.ok, false);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(payload.providers.length, 6);
  for (const provider of payload.providers) {
    assert.equal(provider.status, 'config-error');
    assert.ok(provider.message.includes('密钥文件'));
  }
});
