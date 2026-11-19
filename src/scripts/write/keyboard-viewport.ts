/**
 * 手机端发文助手（/write/）软键盘与可视视口适配器：
 * 1. 动态绑定 visualViewport（vv.offsetTop / vv.height）到 CSS 变量，保证主体壳层与底部抽屉（.mw-sheet-mask）
 *    始终严格贴合未被软键盘遮挡的可视区域；
 * 2. 兼容「收缩布局视口（Chrome interactive-widget）」、「仅收缩 visualViewport（iOS Safari）」与
 *    「不收缩视口的覆盖式键盘（部分 Android WebView / 微信内置浏览器）」三种机制；
 * 3. 在 focusin、keyboard 展开动画、VisualViewport resize、折叠区展开以及输入换行时自动把当前聚焦输入控件
 *    或富文本光标滚动到键盘上方舒适可视区，防止下方元素被软键盘遮住。
 */

export interface KeyboardViewportOptions {
  shell: HTMLElement;
  getRichCursorRect?: () => { top: number; bottom: number } | null;
}

const NON_KEYBOARD_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'range',
  'color',
  'hidden',
]);

function isTextEditableElement(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.readOnly || input.disabled) return false;
    return !NON_KEYBOARD_INPUT_TYPES.has((input.type || 'text').toLowerCase());
  }
  return el.isContentEditable;
}

function isTouchEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches
    || navigator.maxTouchPoints > 0
    || 'ontouchstart' in window,
  );
}

function getVirtualKeyboardRectHeight(): number {
  const vk = (navigator as unknown as {
    virtualKeyboard?: { boundingRect?: { height?: number } };
  }).virtualKeyboard;
  return Math.max(0, Math.round(vk?.boundingRect?.height || 0));
}

export interface KeyboardViewportController {
  ensureVisible: () => void;
  destroy: () => void;
}

export function setupMobileKeyboardViewport(options: KeyboardViewportOptions): KeyboardViewportController {
  const { shell, getRichCursorRect } = options;
  const rootStyle = document.documentElement.style;

  let baselineHeight = Math.max(
    window.innerHeight || 0,
    Math.round(window.visualViewport?.height || 0),
  );
  let lastWidth = window.innerWidth || 0;
  let blurTimer = 0;
  const revealTimers: number[] = [];

  const clearRevealTimers = () => {
    while (revealTimers.length) {
      window.clearTimeout(revealTimers.pop());
    }
  };

  const readState = () => {
    const vv = window.visualViewport;
    const vvTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
    const vvHeight = vv ? Math.max(200, Math.round(vv.height)) : Math.max(200, window.innerHeight || 0);
    const activeFocused = isTextEditableElement(document.activeElement);

    const curWidth = window.innerWidth || 0;
    if (Math.abs(curWidth - lastWidth) > 40) {
      lastWidth = curWidth;
      baselineHeight = Math.max(window.innerHeight || 0, vvHeight);
    } else if (!activeFocused) {
      baselineHeight = Math.max(baselineHeight, window.innerHeight || 0, vvHeight);
    }

    const shrinkPx = Math.max(0, baselineHeight - vvHeight);
    const vkRectH = getVirtualKeyboardRectHeight();
    const keyboardResized = shrinkPx > 90 || vkRectH > 90;
    const touchDevice = isTouchEnvironment();
    const overlayKeyboard = touchDevice && activeFocused && !keyboardResized;
    const kbOpen = activeFocused && (keyboardResized || touchDevice);

    return { vvTop, vvHeight, vkRectH, keyboardResized, overlayKeyboard, kbOpen };
  };

  const syncViewportVars = () => {
    const { vvTop, vvHeight, vkRectH, keyboardResized, overlayKeyboard, kbOpen } = readState();
    const layoutHeight = vkRectH > 90 && Math.abs(vvHeight - baselineHeight) < 40
      ? Math.max(220, vvHeight - vkRectH)
      : vvHeight;

    rootStyle.setProperty('--mw-vv-top', `${vvTop}px`);
    rootStyle.setProperty('--mw-vv-height', `${layoutHeight}px`);

    if (overlayKeyboard) {
      rootStyle.setProperty('--mw-kb-pad', 'max(46vh, 320px)');
      rootStyle.setProperty('--mw-sheet-kb-pad', 'max(42vh, 280px)');
    } else if (keyboardResized) {
      rootStyle.setProperty('--mw-kb-pad', '48px');
      rootStyle.setProperty('--mw-sheet-kb-pad', '16px');
    } else {
      rootStyle.setProperty('--mw-kb-pad', '0px');
      rootStyle.setProperty('--mw-sheet-kb-pad', '0px');
    }

    shell.classList.toggle('is-kb-open', kbOpen);
    document.querySelectorAll('.mw-sheet').forEach((sheet) => {
      sheet.classList.toggle('is-kb-open', kbOpen);
    });

    return { layoutHeight, overlayKeyboard };
  };

  const ensureFocusedVisible = () => {
    const { layoutHeight, overlayKeyboard } = syncViewportVars();
    const active = document.activeElement;
    if (!isTextEditableElement(active)) return;

    const container = active.closest('.mw-sheet, .mw-daily-main, .mw-editor-area') as HTMLElement | null;
    if (!container) return;

    const cRect = container.getBoundingClientRect();
    if (cRect.height <= 40) return;

    // 如果是覆盖式键盘（视口高度未缩小），为屏幕底部保留约 45% 高度避免被软键盘盖住
    const overlayReserve = overlayKeyboard
      ? Math.min(Math.round(layoutHeight * 0.45), Math.max(220, cRect.height - 130))
      : 0;
    const visibleTop = cRect.top + 12;
    const visibleBottom = cRect.bottom - overlayReserve - 22;
    if (visibleBottom <= visibleTop + 24) return;

    let targetTop = 0;
    let targetBottom = 0;
    if (active.isContentEditable) {
      const caret = getRichCursorRect?.();
      if (!caret) return;
      targetTop = caret.top;
      targetBottom = caret.bottom + 8;
    } else {
      const targetBox = (active.closest('.mom-row, .mw-form label') || active).getBoundingClientRect();
      targetTop = targetBox.top;
      targetBottom = targetBox.bottom;
    }

    if (targetBottom > visibleBottom) {
      const targetHeight = targetBottom - targetTop;
      const visibleHeight = visibleBottom - visibleTop;
      const comfortableTop = visibleTop + Math.max(10, visibleHeight * 0.34);
      const desiredPush = Math.max(targetBottom - visibleBottom, targetTop - comfortableTop);
      const maxPushWithoutClippingTop = Math.max(0, targetTop - visibleTop);
      const delta = targetHeight <= visibleHeight
        ? Math.min(desiredPush, maxPushWithoutClippingTop)
        : Math.max(0, targetBottom - visibleBottom);
      if (delta > 3) container.scrollTop += Math.round(delta);
    } else if (targetTop < visibleTop) {
      const delta = visibleTop - targetTop;
      if (delta > 3) container.scrollTop = Math.max(0, container.scrollTop - Math.round(delta));
    }
  };

  const scheduleRevealPasses = () => {
    clearRevealTimers();
    syncViewportVars();
    for (const delay of [0, 80, 220, 400]) {
      revealTimers.push(window.setTimeout(() => ensureFocusedVisible(), delay));
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!isTextEditableElement(e.target as Element | null)) return;
    window.clearTimeout(blurTimer);
    scheduleRevealPasses();
  };

  const onFocusOut = () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      if (!isTextEditableElement(document.activeElement)) {
        clearRevealTimers();
        syncViewportVars();
      }
    }, 120);
  };

  const onViewportChange = () => {
    ensureFocusedVisible();
  };

  const onOrientationChange = () => {
    window.setTimeout(() => {
      lastWidth = window.innerWidth || 0;
      baselineHeight = Math.max(window.innerHeight || 0, Math.round(window.visualViewport?.height || 0));
      syncViewportVars();
    }, 240);
  };

  const onInputOrDetails = () => {
    window.requestAnimationFrame(() => ensureFocusedVisible());
  };

  const onDetailsToggle = (e: Event) => {
    const details = e.target as HTMLDetailsElement | null;
    if (!details || details.tagName !== 'DETAILS' || !details.open) return;
    window.requestAnimationFrame(() => {
      const container = details.closest('.mw-daily-main, .mw-sheet') as HTMLElement | null;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const dRect = details.getBoundingClientRect();
      if (dRect.bottom > cRect.bottom - 20) {
        container.scrollBy({
          top: Math.min(dRect.top - cRect.top - 16, Math.max(120, dRect.bottom - cRect.bottom + 36)),
          behavior: 'smooth',
        });
      }
    });
  };

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('input', onInputOrDetails, true);
  document.addEventListener('toggle', onDetailsToggle, true);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onOrientationChange);

  syncViewportVars();

  return {
    ensureVisible: ensureFocusedVisible,
    destroy: () => {
      clearRevealTimers();
      window.clearTimeout(blurTimer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onInputOrDetails, true);
      document.removeEventListener('toggle', onDetailsToggle, true);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onOrientationChange);
    },
  };
}
