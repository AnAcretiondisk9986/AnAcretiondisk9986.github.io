/** 轻量堆叠 Toast：自动垂直排列不重叠、同类消息短时去重、点击可关闭。 */
export function createToast({ duration = 4000, maxVisible = 4 } = {}) {
  let stackEl = null;
  let lastMsg = '';
  let lastTime = 0;
  let lastEl = null;
  let lastTimer = null;

  function ensureStack() {
    if (stackEl && stackEl.isConnected) return stackEl;
    stackEl = document.createElement('div');
    stackEl.className = 'toast-stack';
    stackEl.setAttribute('aria-live', 'polite');
    stackEl.setAttribute('aria-atomic', 'false');
    document.body.appendChild(stackEl);
    return stackEl;
  }

  function detectTone(text) {
    if (/失败|错误|冲突|拒绝|不能|无法|异常|无效|超限|超过/.test(text)) return 'error';
    if (/警告|注意|未保存|跳过|尚未|取消/.test(text)) return 'warn';
    if (/已保存|已创建|已删除|已复制|已上传|已插入|已恢复|已同步|已发布|已归档|已完成|推送成功|已解锁|已导入/.test(text)) return 'ok';
    return '';
  }

  return function toast(message, { tone = '', durationMs = duration } = {}) {
    const text = String(message ?? '');
    const now = Date.now();
    const stack = ensureStack();
    if (text && text === lastMsg && now - lastTime < 800 && lastEl && lastEl.isConnected) {
      clearTimeout(lastTimer);
      lastTime = now;
      lastTimer = setTimeout(() => lastEl?.remove(), durationMs);
      return lastEl;
    }

    while (stack.children.length >= maxVisible) {
      stack.firstElementChild?.remove();
    }

    const resolvedTone = tone || detectTone(text);
    const el = document.createElement('div');
    el.className = `toast${resolvedTone ? ` toast--${resolvedTone}` : ''}`;
    el.setAttribute('role', resolvedTone === 'error' ? 'alert' : 'status');
    el.textContent = text;
    el.title = '点击关闭';
    const timer = setTimeout(() => el.remove(), durationMs);
    el.addEventListener('click', () => { clearTimeout(timer); el.remove(); });
    stack.appendChild(el);

    lastMsg = text;
    lastTime = now;
    lastEl = el;
    lastTimer = timer;
    return el;
  };
}
