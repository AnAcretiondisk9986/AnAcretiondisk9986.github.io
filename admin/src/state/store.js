/**
 * 极简全局 store：订阅/发布，供跨模块共享状态（同步状态、当前模块等）。
 * 业务状态仍以各模块局部变量为主，逐步迁移到该 store。
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get() { return state; },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((fn) => {
        try { fn(state); } catch { /* 单个订阅者异常不影响其它订阅者 */ }
      });
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore({
  mode: 'posts',
  // 页面：loading | ready | empty | error
  page: 'loading',
  // 编辑：pristine | dirty | saving | saved | save-error
  editor: { status: 'pristine', dirty: false, saving: false, lastSavedAt: null, lastError: null },
  syncStatus: null,
  // 上传：active 进行中数量，failed 失败数量
  upload: { active: 0, failed: 0 },
  mediaStats: null,
});
