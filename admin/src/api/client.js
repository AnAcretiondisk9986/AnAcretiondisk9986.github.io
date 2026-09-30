/** 管理 API 客户端：统一注入管理口令、校验 JSON 响应、解析错误。 */
import { apiErrorMessage, isJsonResponse } from './errors.js';

export function createApiClient({ token, getToken } = {}) {
  const resolveToken = () => (typeof getToken === 'function' ? getToken() : token) || '';

  async function apiFetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}), 'x-admin-token': resolveToken() };
    const res = await fetch(url, { ...opts, headers });
    if (!isJsonResponse(res)) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      // 打开了 Astro/静态站点或旧版管理进程时，/api 会返回 HTML
      if (contentType.includes('text/html') || contentType === '') {
        throw new Error('管理接口返回了网页，请重启管理面板并访问 http://localhost:4322/admin');
      }
      throw new Error(`管理接口返回非 JSON（HTTP ${res.status}）`);
    }
    return res;
  }

  /** 请求 JSON 接口：非 2xx 或带 error 时抛出带 status/data 的错误 */
  async function apiJson(url, opts = {}) {
    const res = await apiFetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || data.error) {
      const err = new Error(apiErrorMessage(data, `HTTP ${res.status}`));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return { apiFetch, apiJson };
}

export { apiErrorMessage, isJsonResponse };
