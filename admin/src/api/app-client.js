/** 应用级 API 客户端单例：口令可在运行期更新（锁定/解锁） */
import { createApiClient } from './client.js';

let token = (typeof window !== 'undefined' && window.__ADMIN_TOKEN__) || '';
const client = createApiClient({ getToken: () => token });

export function getToken() {
  return token;
}

export function setToken(value) {
  token = String(value || '');
}

export const apiFetch = client.apiFetch;
export const apiJson = client.apiJson;
export { apiErrorMessage, isJsonResponse } from './errors.js';
