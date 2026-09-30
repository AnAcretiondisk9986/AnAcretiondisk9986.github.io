import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, store } from '../admin/src/state/store.js';

test('createStore 支持初始值、set 与函数式更新', () => {
  const s = createStore({ a: 1, b: 2 });
  assert.deepEqual(s.get(), { a: 1, b: 2 });
  s.set({ a: 10 });
  assert.deepEqual(s.get(), { a: 10, b: 2 });
  s.set((prev) => ({ b: prev.b + 1 }));
  assert.deepEqual(s.get(), { a: 10, b: 3 });
});

test('createStore 订阅在变更时收到新状态，可退订', () => {
  const s = createStore({ n: 0 });
  const seen = [];
  const off = s.subscribe((state) => seen.push(state.n));
  s.set({ n: 1 });
  s.set({ n: 2 });
  off();
  s.set({ n: 3 });
  assert.deepEqual(seen, [1, 2]);
});

test('createStore 单个订阅者异常不影响其它订阅者', () => {
  const s = createStore({ n: 0 });
  const seen = [];
  s.subscribe(() => { throw new Error('boom'); });
  s.subscribe((state) => seen.push(state.n));
  s.set({ n: 5 });
  assert.deepEqual(seen, [5]);
});

test('全局 store 覆盖文档中的状态机维度', () => {
  const state = store.get();
  assert.equal(typeof state.mode, 'string');
  assert.ok(['loading', 'ready', 'empty', 'error'].includes(state.page));
  assert.ok(['pristine', 'dirty', 'saving', 'saved', 'save-error'].includes(state.editor.status));
  assert.equal(typeof state.upload.active, 'number');
  assert.equal(typeof state.upload.failed, 'number');
});
