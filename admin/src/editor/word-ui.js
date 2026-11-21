/**
 * PC 端 Word 级排版工具栏与编辑区控制器：
 * 封装双行 Ribbon 工具栏、选区浮动条、表格浮动栏、查找替换、实时大纲、
 * 调色板/表情/表格网格弹层，以及「所见即所得 / 分屏预览 / Markdown 源码」三视图同步。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import {
  createWordEditor,
  markdownToEditorHtml,
  serializeDocToMarkdown,
  extractOutlineFromDoc,
  katex,
} from '../../vendor/tiptap-bundle.mjs';

const TEXT_COLORS = [
  '#ece7dc', '#ff5a1a', '#ffb86c', '#f1fa8c', '#50fa7b',
  '#8be9fd', '#8fb3ff', '#bd93f9', '#ff79c6', '#ff5555',
  '#b99c60', '#8a8a90',
];

const HIGHLIGHT_COLORS = [
  'rgba(255, 90, 26, 0.32)',
  'rgba(250, 204, 21, 0.34)',
  'rgba(74, 222, 128, 0.28)',
  'rgba(96, 165, 250, 0.30)',
  'rgba(244, 114, 182, 0.28)',
  'rgba(167, 139, 250, 0.28)',
];

const EMOJIS = [
  '✨', '🔥', '💡', '📝', '📌', '✅', '⚠️', '❌', '🚀', '🎯',
  '🎉', '❤️', '🤩', '😅', '🤔', '😭', '🙏', '👏', '👍', '👀',
  '🎧', '🎵', '🎬', '📷', '📚', '💻', '🧠', '🩺', '🌌', '☀️',
];

export function renderWordRibbonHtml() {
  return `
    <div class="word-ribbon" id="wordRibbon">
      <div class="word-ribbon__row">
        <div class="ribbon-group">
          <button class="btn small" type="button" data-cmd="undo" title="撤销 (Ctrl+Z)">↶</button>
          <button class="btn small" type="button" data-cmd="redo" title="重做 (Ctrl+Y)">↷</button>
          <button class="btn small" type="button" id="btnFormatPainter" title="格式刷：单击刷一次，双击连续锁定">🖌 格式刷</button>
          <button class="btn small" type="button" data-cmd="clearFormat" title="清除所选文字格式">✕ 清格式</button>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group">
          <select id="fFmtBlock" class="ribbon-select" title="段落样式">
            <option value="p">正文</option>
            <option value="h1">标题 1</option>
            <option value="h2">标题 2</option>
            <option value="h3">标题 3</option>
            <option value="h4">标题 4</option>
            <option value="blockquote">引用</option>
            <option value="codeBlock">代码块</option>
          </select>
          <select id="fFmtFont" class="ribbon-select" title="字体">
            <option value="">默认字体</option>
            <option value="var(--f-serif, 'Noto Serif SC', serif)">宋体 / Serif</option>
            <option value="var(--f-mono, 'JetBrains Mono', monospace)">等宽 / Mono</option>
          </select>
          <select id="fFmtSize" class="ribbon-select ribbon-select--narrow" title="字号">
            <option value="">字号</option>
            <option value="12px">12</option>
            <option value="14px">14</option>
            <option value="16px">16</option>
            <option value="18px">18</option>
            <option value="20px">20</option>
            <option value="24px">24</option>
            <option value="28px">28</option>
            <option value="36px">36</option>
          </select>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group">
          <button class="btn small fmt-toggle" type="button" data-cmd="bold" title="加粗 (Ctrl+B)"><b>B</b></button>
          <button class="btn small fmt-toggle" type="button" data-cmd="italic" title="斜体 (Ctrl+I)"><i>I</i></button>
          <button class="btn small fmt-toggle" type="button" data-cmd="underline" title="下划线 (Ctrl+U)"><u>U</u></button>
          <button class="btn small fmt-toggle" type="button" data-cmd="strike" title="删除线"><s>S</s></button>
          <button class="btn small fmt-toggle" type="button" data-cmd="code" title="行内代码">&lt;/&gt;</button>
          <button class="btn small fmt-toggle" type="button" data-cmd="superscript" title="上标">X²</button>
          <button class="btn small fmt-toggle" type="button" data-cmd="subscript" title="下标">X₂</button>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group ribbon-popover-host">
          <button class="btn small" type="button" id="btnTextColor" title="文字颜色">A<span class="color-bar" id="textColorBar"></span></button>
          <button class="btn small" type="button" id="btnHighlightColor" title="荧光高亮">🖍<span class="color-bar color-bar--hl" id="hlColorBar"></span></button>
          <div class="ribbon-popover" id="popTextColor" hidden></div>
          <div class="ribbon-popover" id="popHighlightColor" hidden></div>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group">
          <button class="btn small fmt-toggle" type="button" data-align="left" title="左对齐">⇤</button>
          <button class="btn small fmt-toggle" type="button" data-align="center" title="居中对齐">⇔</button>
          <button class="btn small fmt-toggle" type="button" data-align="right" title="右对齐">⇥</button>
          <button class="btn small fmt-toggle" type="button" data-align="justify" title="两端对齐">☰</button>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group">
          <button class="btn small fmt-toggle" type="button" data-cmd="bulletList" title="无序列表">• 列表</button>
          <button class="btn small fmt-toggle" type="button" data-cmd="orderedList" title="有序列表">1. 列表</button>
          <button class="btn small fmt-toggle" type="button" data-cmd="taskList" title="任务清单">☑ 待办</button>
          <button class="btn small" type="button" data-cmd="outdent" title="减少缩进">⇤</button>
          <button class="btn small" type="button" data-cmd="indent" title="增加缩进">⇥</button>
          <button class="btn small fmt-toggle" type="button" id="btnTextIndent" title="首行缩进 2em">¶ 缩进</button>
          <select id="fLineHeight" class="ribbon-select ribbon-select--narrow" title="行距">
            <option value="">行距</option>
            <option value="1.5">1.5×</option>
            <option value="1.8">1.8×</option>
            <option value="2.0">2.0×</option>
            <option value="2.2">2.2×</option>
          </select>
        </div>
      </div>

      <div class="word-ribbon__row">
        <div class="ribbon-group">
          <button class="btn small" type="button" id="btnInsertUploadImg" title="上传图片（支持多图）">🖼 插图</button>
          <button class="btn small" type="button" id="btnInsertGallery" title="从媒体库多选插入并排拼图">▦ 拼图</button>
          <button class="btn small" type="button" id="btnInsertMedia" title="从媒体库插入图片 / 音频 / 视频 / 附件">▤ 媒体库</button>
          <button class="btn small" type="button" id="btnInsertImgSize" title="调整选中或首张图片宽度">⛶ 图宽</button>
          <button class="btn small" type="button" id="btnInsertVideo" title="插入 B站 / YouTube / 本地视频">▶ 视频</button>
          <button class="btn small" type="button" id="btnInsertMusic" title="插入音乐播放条">♪ 音乐</button>
          <button class="btn small" type="button" id="btnInsertAttach" title="上传或插入 PDF / 文件附件卡片">📎 附件</button>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group ribbon-popover-host">
          <button class="btn small" type="button" id="btnInsertTable" title="插入表格">⊞ 表格</button>
          <div class="ribbon-popover table-grid-pop" id="popTableGrid" hidden></div>
          <button class="btn small" type="button" id="btnInsertCallout" title="插入提示框（笔记/提示/注意/警告）">📝 提示框</button>
          <div class="ribbon-popover callout-pop" id="popCalloutMenu" hidden>
            <button type="button" class="btn small" data-callout-kind="note">📝 笔记框</button>
            <button type="button" class="btn small" data-callout-kind="tip">💡 提示框</button>
            <button type="button" class="btn small" data-callout-kind="warn">⚠ 注意框</button>
            <button type="button" class="btn small" data-callout-kind="danger">❗ 警告框</button>
            <button type="button" class="btn small" data-callout-kind="quote">❝ 摘录框</button>
          </div>
          <button class="btn small" type="button" id="btnInsertDetails" title="插入可折叠详情块">▸ 折叠</button>
          <button class="btn small" type="button" id="btnInsertMath" title="插入 LaTeX 数学公式">∑ 公式</button>
          <button class="btn small" type="button" id="btnInsertBookmark" title="插入网页书签卡片">🔖 书签</button>
          <button class="btn small" type="button" id="btnInsertLink" title="插入 / 编辑超链接">🔗 链接</button>
          <button class="btn small" type="button" id="btnInsertHr" title="插入分割线">—</button>
          <button class="btn small" type="button" id="btnInsertEmoji" title="插入表情符号">😊</button>
          <div class="ribbon-popover emoji-pop" id="popEmoji" hidden></div>
        </div>

        <span class="fmt-sep"></span>

        <div class="ribbon-group" style="margin-left:auto">
          <button class="btn small" type="button" id="btnFindReplace" title="查找与替换 (Ctrl+F / Ctrl+H)">🔍 查找</button>
          <button class="btn small" type="button" id="btnOutline" title="显示 / 隐藏文档大纲">☰ 大纲</button>
          <button class="btn small" type="button" id="btnTypewriter" title="打字机居中模式">⌨ 打字机</button>
          <button class="btn small" type="button" id="btnFocusMode" title="专注模式：隐藏文章列表栏">⤢ 专注</button>
          <div class="view-switch" id="viewSwitch">
            <button type="button" data-view="wysiwyg" class="active" title="Word 级所见即所得排版">所见即所得</button>
            <button type="button" data-view="sv" title="左侧 Markdown 源码 + 右侧实时渲染">分屏</button>
            <button type="button" data-view="source" title="纯 Markdown/HTML 源码">源码</button>
          </div>
        </div>
      </div>
    </div>

    <div class="find-replace-bar" id="findReplaceBar" hidden>
      <input id="fFindQuery" placeholder="查找文本…" autocomplete="off" />
      <span class="find-count" id="findCount">0/0</span>
      <button class="btn small" type="button" id="btnFindCase" title="区分大小写">Aa</button>
      <button class="btn small" type="button" id="btnFindPrev" title="上一个">↑</button>
      <button class="btn small" type="button" id="btnFindNext" title="下一个">↓</button>
      <input id="fReplaceQuery" placeholder="替换为…" autocomplete="off" />
      <button class="btn small" type="button" id="btnReplaceOne">替换</button>
      <button class="btn small" type="button" id="btnReplaceAll">全部替换</button>
      <button class="btn small" type="button" id="btnFindClose" title="关闭">×</button>
    </div>

    <div class="table-context-bar" id="tableContextBar" hidden>
      <span>表格：</span>
      <button class="btn small" type="button" data-tbl="addRowBefore">+上行</button>
      <button class="btn small" type="button" data-tbl="addRowAfter">+下行</button>
      <button class="btn small" type="button" data-tbl="deleteRow">-删行</button>
      <span class="fmt-sep"></span>
      <button class="btn small" type="button" data-tbl="addColBefore">+左列</button>
      <button class="btn small" type="button" data-tbl="addColAfter">+右列</button>
      <button class="btn small" type="button" data-tbl="deleteCol">-删列</button>
      <span class="fmt-sep"></span>
      <button class="btn small" type="button" data-tbl="toggleHeader">表头行</button>
      <button class="btn small" type="button" data-tbl="mergeSplit">合并/拆分</button>
      <button class="btn small danger" type="button" data-tbl="deleteTable">删表</button>
    </div>
  `;
}

export function mountWordEditor({
  container,
  initialMarkdown = '',
  renderPreview,
  onDirty,
  onStatsChange,
  onUploadImages,
  onImportExternalImages,
  onOpenMediaPicker,
  onOpenMath,
  onOpenVideo,
  onOpenMusic,
  onOpenAttach,
  onOpenBookmark,
  onOpenImgSize,
  onSaveShortcut,
  toast,
} = {}) {
  if (!container) return null;

  container.innerHTML = `
    <div class="acr-editor-shell" data-editor-ready="1">
      <div class="acr-editor-stage">
        <div class="acr-wysiwyg-pane" id="acrWysiwygPane">
          <div id="acrProseHost"></div>
        </div>
        <div class="acr-source-pane" id="acrSourcePane" hidden>
          <textarea id="acrSourceInput" class="acr-source-textarea" spellcheck="false" placeholder="Markdown / HTML 源码…"></textarea>
        </div>
        <div class="acr-preview-pane" id="acrPreviewPane" hidden>
          <div class="acr-site-preview" id="acrLivePreview"></div>
        </div>
        <aside class="acr-outline-pane" id="acrOutlinePane" hidden>
          <div class="acr-outline-head"><span>文档大纲</span><button type="button" class="btn small" id="btnOutlineClose">×</button></div>
          <div class="acr-outline-list" id="acrOutlineList"></div>
        </aside>
      </div>
      <div class="acr-bubble-menu" id="acrBubbleMenu" hidden>
        <button type="button" data-cmd="bold" title="加粗"><b>B</b></button>
        <button type="button" data-cmd="italic" title="斜体"><i>I</i></button>
        <button type="button" data-cmd="underline" title="下划线"><u>U</u></button>
        <button type="button" data-cmd="strike" title="删除线"><s>S</s></button>
        <button type="button" data-cmd="code" title="代码">&lt;/&gt;</button>
        <button type="button" data-bubble="highlight" title="高亮">🖍</button>
        <button type="button" data-bubble="color" title="橙色强调">A</button>
        <button type="button" data-bubble="link" title="链接">🔗</button>
        <button type="button" data-cmd="clearFormat" title="清格式">✕</button>
      </div>
    </div>
  `;

  const wysiwygPane = container.querySelector('#acrWysiwygPane');
  const proseHost = container.querySelector('#acrProseHost');
  const sourcePane = container.querySelector('#acrSourcePane');
  const sourceInput = container.querySelector('#acrSourceInput');
  const previewPane = container.querySelector('#acrPreviewPane');
  const livePreview = container.querySelector('#acrLivePreview');
  const outlinePane = container.querySelector('#acrOutlinePane');
  const outlineList = container.querySelector('#acrOutlineList');
  const bubbleMenu = container.querySelector('#acrBubbleMenu');

  let currentView = localStorage.getItem('admin-editor-view');
  if (!['wysiwyg', 'sv', 'source'].includes(currentView)) currentView = 'wysiwyg';
  let typewriterOn = localStorage.getItem('admin-typewriter') === '1';
  let outlineOpen = localStorage.getItem('admin-outline') === '1';
  let previewTimer = null;
  let outlineTimer = null;
  let sourceDirtyTimer = null;
  let caretRaf = 0;
  let cachedDoc = null;
  let cachedMarkdown = '';
  let sourceMatches = [];
  let sourceActiveIdx = 0;
  let sourceCaseSensitive = false;
  let lastActiveColor = '#ff5a1a';
  let lastHighlightColor = HIGHLIGHT_COLORS[0];

  function scheduleOutlineSync() {
    if (outlinePane.hidden) return;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      outlineTimer = null;
      syncOutline();
    }, 220);
  }

  function scheduleCaretCenter() {
    if (!typewriterOn || currentView !== 'wysiwyg') return;
    if (caretRaf) return;
    caretRaf = requestAnimationFrame(() => {
      caretRaf = 0;
      centerCaretInViewport();
    });
  }

  const word = createWordEditor({
    element: proseHost,
    initialMarkdown,
    onUpdate: () => {
      cachedDoc = null;
      scheduleOutlineSync();
      onDirty?.();
      onStatsChange?.();
      scheduleCaretCenter();
    },
    onSelectionUpdate: () => {
      syncRibbonStates();
      syncBubbleMenu();
      syncTableBar();
      scheduleCaretCenter();
    },
    onUploadImages,
    onImportExternalImages,
    onNodeAction: (action, payload) => {
      if (action === 'replace-image') {
        onOpenMediaPicker?.({
          type: 'image',
          title: '替换图片',
          onPick: (m) => { payload?.updateAttrs?.({ src: m.url, alt: m.name.replace(/\.[^.]+$/, '') }); },
        });
      } else if (action === 'gallery-add') {
        onOpenMediaPicker?.({
          type: 'image',
          multiple: true,
          title: '向拼图添加图片',
          onPickBatch: (list) => {
            const added = list.map((m) => ({ src: m.url, alt: m.name.replace(/\.[^.]+$/, '') }));
            payload?.updateAttrs?.({ images: [...(payload.currentImages || []), ...added] });
          },
        });
      }
    },
    onSlashAction: (action) => {
      if (action === 'upload-image') $('#editorMultiImgInput')?.click();
      else if (action === 'insert-gallery') triggerGalleryInsert();
      else if (action === 'insert-video') onOpenVideo?.();
      else if (action === 'insert-music') onOpenMusic?.();
      else if (action === 'insert-attachment') onOpenAttach?.();
      else if (action === 'insert-math-block') onOpenMath?.(true);
      else if (action === 'insert-bookmark') onOpenBookmark?.();
    },
    onShortcutSave: onSaveShortcut,
    onShortcutFind: (withReplace) => toggleFindBar(true, withReplace),
  });

  const ed = word.editor;

  function centerCaretInViewport() {
    if (currentView !== 'wysiwyg') return;
    try {
      const sel = ed.state.selection;
      const coords = ed.view.coordsAtPos(sel.from);
      const rect = wysiwygPane.getBoundingClientRect();
      const targetY = rect.top + rect.height * 0.44;
      const delta = coords.top - targetY;
      if (Math.abs(delta) > 28) wysiwygPane.scrollTop += delta;
    } catch { /* ignore */ }
  }

  function getMarkdown() {
    if (currentView === 'sv' || currentView === 'source') return sourceInput.value;
    const doc = ed.state.doc;
    if (cachedDoc === doc) return cachedMarkdown;
    cachedMarkdown = word.getMarkdown();
    cachedDoc = doc;
    return cachedMarkdown;
  }

  function setMarkdown(md) {
    const val = String(md || '');
    cachedDoc = null;
    if (currentView === 'sv' || currentView === 'source') {
      sourceInput.value = val;
      if (currentView === 'sv') renderPreview?.(livePreview, val);
    }
    word.setMarkdown(val);
    syncOutline();
    syncRibbonStates();
  }

  function insertMarkdownBlock(md) {
    if (currentView === 'sv' || currentView === 'source') {
      const start = sourceInput.selectionStart ?? sourceInput.value.length;
      const end = sourceInput.selectionEnd ?? start;
      const insert = `\n${String(md || '').trim()}\n`;
      sourceInput.setRangeText(insert, start, end, 'end');
      sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    cachedDoc = null;
    word.insertMarkdownBlock(md);
    onDirty?.();
    onStatsChange?.();
  }

  function applyView(nextView, { silent = false } = {}) {
    const target = ['wysiwyg', 'sv', 'source'].includes(nextView) ? nextView : 'wysiwyg';
    const prev = currentView;
    if (prev !== target) {
      if (prev === 'wysiwyg' && (target === 'sv' || target === 'source')) {
        sourceInput.value = getMarkdown();
      } else if ((prev === 'sv' || prev === 'source') && target === 'wysiwyg') {
        cachedDoc = null;
        word.setMarkdown(sourceInput.value);
      }
    }
    currentView = target;
    wysiwygPane.hidden = target !== 'wysiwyg';
    sourcePane.hidden = target === 'wysiwyg';
    previewPane.hidden = target !== 'sv';
    if (target === 'sv') renderPreview?.(livePreview, sourceInput.value);
    const vs = $('#viewSwitch');
    if (vs) vs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === target));
    if (!silent) {
      try { localStorage.setItem('admin-editor-view', target); } catch { /* ignore */ }
    }
    syncOutline();
    if (!$('#findReplaceBar')?.hidden) runActiveSearch($('#fFindQuery')?.value || '', { selectActive: false });
    return true;
  }

  sourceInput.addEventListener('input', () => {
    clearTimeout(sourceDirtyTimer);
    sourceDirtyTimer = setTimeout(() => {
      sourceDirtyTimer = null;
      onDirty?.();
      onStatsChange?.();
    }, 120);
    scheduleOutlineSync();
    if (currentView === 'sv') {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => renderPreview?.(livePreview, sourceInput.value), 180);
    }
    if (!$('#findReplaceBar')?.hidden) {
      runSourceSearch($('#fFindQuery')?.value || '', { selectActive: false });
    }
  });

  sourceInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSaveShortcut?.();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) {
      e.preventDefault();
      toggleFindBar(true, e.key.toLowerCase() === 'h');
    }
  });

  // ── 实时大纲 ──
  function syncOutline() {
    if (outlinePane.hidden) return;
    const headings = currentView === 'wysiwyg'
      ? word.getOutline()
      : extractOutlineFromSource(sourceInput.value);
    if (!headings.length) {
      outlineList.innerHTML = '<div class="acr-outline-empty">暂无标题（H1–H4 自动生成大纲）</div>';
      return;
    }
    outlineList.innerHTML = headings
      .map((h, i) => `<button type="button" class="acr-outline-item lv-${h.level}" data-oidx="${i}">${esc(h.text)}</button>`)
      .join('');
    outlineList.querySelectorAll('[data-oidx]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.oidx);
        if (currentView === 'wysiwyg') {
          const domHeadings = proseHost.querySelectorAll('h1, h2, h3, h4, h5, h6');
          const el = domHeadings[idx];
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          const target = headings[idx];
          if (target && typeof target.offset === 'number') {
            sourceInput.focus();
            sourceInput.setSelectionRange(target.offset, target.offset + target.rawLength);
            const linesBefore = sourceInput.value.slice(0, target.offset).split('\n').length - 1;
            const lineH = parseFloat(getComputedStyle(sourceInput).lineHeight) || 22;
            sourceInput.scrollTop = Math.max(0, linesBefore * lineH - sourceInput.clientHeight * 0.3);
          }
          if (currentView === 'sv') {
            const previewHeadings = livePreview.querySelectorAll('h1, h2, h3, h4, h5, h6');
            previewHeadings[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      };
    });
  }

  function extractOutlineFromSource(md) {
    const out = [];
    let offset = 0;
    let inFence = false;
    for (const line of String(md || '').split('\n')) {
      if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
      if (!inFence) {
        const m = line.match(/^(#{1,4})\s+(.+)$/);
        if (m) out.push({ level: m[1].length, text: m[2].replace(/<[^>]+>/g, '').trim(), offset, rawLength: line.length });
      }
      offset += line.length + 1;
    }
    return out;
  }

  function toggleOutline(force) {
    const next = typeof force === 'boolean' ? force : outlinePane.hidden;
    outlinePane.hidden = !next;
    outlineOpen = next;
    $('#btnOutline')?.classList.toggle('primary', next);
    try { localStorage.setItem('admin-outline', next ? '1' : '0'); } catch { /* ignore */ }
    if (next) syncOutline();
  }

  // ── 浮动选区工具栏 & 表格上下文条 ──
  function syncBubbleMenu() {
    if (currentView !== 'wysiwyg') { bubbleMenu.hidden = true; return; }
    const { selection } = ed.state;
    if (selection.empty || selection.node) { bubbleMenu.hidden = true; return; }
    try {
      const from = ed.view.coordsAtPos(selection.from);
      const to = ed.view.coordsAtPos(selection.to);
      const shellRect = container.querySelector('.acr-editor-shell').getBoundingClientRect();
      const midX = (from.left + to.left) / 2 - shellRect.left;
      const topY = Math.min(from.top, to.top) - shellRect.top - 42;
      bubbleMenu.hidden = false;
      bubbleMenu.style.left = `${Math.max(8, Math.min(shellRect.width - bubbleMenu.offsetWidth - 8, midX - bubbleMenu.offsetWidth / 2))}px`;
      bubbleMenu.style.top = `${Math.max(6, topY)}px`;
    } catch {
      bubbleMenu.hidden = true;
    }
  }

  function syncTableBar() {
    const bar = $('#tableContextBar');
    if (!bar) return;
    bar.hidden = currentView !== 'wysiwyg' || !ed.isActive('table');
  }

  // ── 同步 Ribbon 激活状态 ──
  function syncRibbonStates() {
    const activeCmds = {
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      strike: ed.isActive('strike'),
      code: ed.isActive('code'),
      superscript: ed.isActive('superscript'),
      subscript: ed.isActive('subscript'),
      bulletList: ed.isActive('bulletList'),
      orderedList: ed.isActive('orderedList'),
      taskList: ed.isActive('taskList'),
    };
    document.querySelectorAll('#wordRibbon [data-cmd].fmt-toggle').forEach((btn) => {
      btn.classList.toggle('active', Boolean(activeCmds[btn.dataset.cmd]));
    });
    document.querySelectorAll('#wordRibbon [data-align]').forEach((btn) => {
      btn.classList.toggle('active', ed.isActive({ textAlign: btn.dataset.align }));
    });
    const blockSel = $('#fFmtBlock');
    if (blockSel) {
      if (ed.isActive('heading', { level: 1 })) blockSel.value = 'h1';
      else if (ed.isActive('heading', { level: 2 })) blockSel.value = 'h2';
      else if (ed.isActive('heading', { level: 3 })) blockSel.value = 'h3';
      else if (ed.isActive('heading', { level: 4 })) blockSel.value = 'h4';
      else if (ed.isActive('blockquote')) blockSel.value = 'blockquote';
      else if (ed.isActive('codeBlock')) blockSel.value = 'codeBlock';
      else blockSel.value = 'p';
    }
    const ts = ed.getAttributes('textStyle') || {};
    if ($('#fFmtFont')) $('#fFmtFont').value = ts.fontFamily || '';
    if ($('#fFmtSize')) $('#fFmtSize').value = ts.fontSize || '';
    const pAttrs = ed.getAttributes('paragraph') || {};
    if ($('#btnTextIndent')) $('#btnTextIndent').classList.toggle('active', Boolean(pAttrs.textIndent));
    if ($('#fLineHeight')) $('#fLineHeight').value = pAttrs.lineHeight || '';
    if ($('#btnFormatPainter')) $('#btnFormatPainter').classList.toggle('active', word.isFormatPainterActive());
  }

  // ── 弹层管理（颜色板 / 高亮板 / 表格选区 / 表情面板） ──
  function closeAllPopovers() {
    document.querySelectorAll('#wordRibbon .ribbon-popover').forEach((p) => { p.hidden = true; });
  }

  function buildColorPopover(pop, colors, { onPick, onClear, defaultCustom }) {
    if (!pop) return;
    pop.innerHTML = `
      <div class="color-swatches">${colors.map((c) => `<button type="button" class="color-swatch" data-c="${escAttr(c)}" style="background:${escAttr(c)}"></button>`).join('')}</div>
      <div class="color-custom-row">
        <input type="color" value="${defaultCustom}" />
        <button type="button" class="btn small" data-clear>清除</button>
      </div>
    `;
    pop.querySelectorAll('[data-c]').forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { onPick(b.dataset.c); closeAllPopovers(); };
    });
    const picker = pop.querySelector('input[type="color"]');
    picker.onchange = () => { onPick(picker.value); closeAllPopovers(); };
    pop.querySelector('[data-clear]').onclick = () => { onClear(); closeAllPopovers(); };
  }

  function buildTableGridPopover(pop) {
    if (!pop) return;
    let html = '<div class="tbl-grid-label">选择表格尺寸</div><div class="tbl-grid-cells">';
    for (let r = 1; r <= 6; r += 1) {
      for (let c = 1; c <= 6; c += 1) {
        html += `<span class="tbl-cell" data-r="${r}" data-c="${c}"></span>`;
      }
    }
    html += '</div>';
    pop.innerHTML = html;
    const label = pop.querySelector('.tbl-grid-label');
    const cells = [...pop.querySelectorAll('.tbl-cell')];
    cells.forEach((cell) => {
      cell.onmouseenter = () => {
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        label.textContent = `${r} 行 × ${c} 列`;
        cells.forEach((x) => x.classList.toggle('hot', Number(x.dataset.r) <= r && Number(x.dataset.c) <= c));
      };
      cell.onmousedown = (e) => e.preventDefault();
      cell.onclick = () => {
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        ed.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run();
        closeAllPopovers();
      };
    });
  }

  function buildEmojiPopover(pop) {
    if (!pop) return;
    pop.innerHTML = EMOJIS.map((em) => `<button type="button" class="emoji-btn" data-em="${em}">${em}</button>`).join('');
    pop.querySelectorAll('[data-em]').forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { ed.chain().focus().insertContent(b.dataset.em).run(); closeAllPopovers(); };
    });
  }

  function wrapSourceSelection(before, after = before, placeholder = '文本') {
    const start = sourceInput.selectionStart ?? sourceInput.value.length;
    const end = sourceInput.selectionEnd ?? start;
    const sel = sourceInput.value.slice(start, end) || placeholder;
    const next = `${before}${sel}${after}`;
    sourceInput.focus();
    sourceInput.setRangeText(next, start, end, 'select');
    sourceInput.setSelectionRange(start + before.length, start + before.length + sel.length);
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function prefixSourceLines(prefix) {
    const start = sourceInput.selectionStart ?? 0;
    const end = sourceInput.selectionEnd ?? start;
    const val = sourceInput.value;
    const lineStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndIdx = val.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
    const block = val.slice(lineStart, lineEnd).split('\n').map((l) => `${prefix}${l}`).join('\n');
    sourceInput.focus();
    sourceInput.setRangeText(block, lineStart, lineEnd, 'end');
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function runFormatCommand(cmd) {
    if (currentView !== 'wysiwyg') {
      if (cmd === 'undo' || cmd === 'redo') { sourceInput.focus(); try { document.execCommand(cmd); } catch { /* ignore */ } return; }
      if (cmd === 'bold') return wrapSourceSelection('**');
      if (cmd === 'italic') return wrapSourceSelection('*');
      if (cmd === 'underline') return wrapSourceSelection('<u>', '</u>');
      if (cmd === 'strike') return wrapSourceSelection('~~');
      if (cmd === 'code') return wrapSourceSelection('`');
      if (cmd === 'superscript') return wrapSourceSelection('<sup>', '</sup>');
      if (cmd === 'subscript') return wrapSourceSelection('<sub>', '</sub>');
      if (cmd === 'bulletList') return prefixSourceLines('- ');
      if (cmd === 'orderedList') return prefixSourceLines('1. ');
      if (cmd === 'taskList') return prefixSourceLines('- [ ] ');
      return;
    }
    if (cmd === 'undo') ed.chain().focus().undo().run();
    else if (cmd === 'redo') ed.chain().focus().redo().run();
    else if (cmd === 'bold') ed.chain().focus().toggleBold().run();
    else if (cmd === 'italic') ed.chain().focus().toggleItalic().run();
    else if (cmd === 'underline') ed.chain().focus().toggleUnderline().run();
    else if (cmd === 'strike') ed.chain().focus().toggleStrike().run();
    else if (cmd === 'code') ed.chain().focus().toggleCode().run();
    else if (cmd === 'superscript') ed.chain().focus().toggleSuperscript().run();
    else if (cmd === 'subscript') ed.chain().focus().toggleSubscript().run();
    else if (cmd === 'bulletList') ed.chain().focus().toggleBulletList().run();
    else if (cmd === 'orderedList') ed.chain().focus().toggleOrderedList().run();
    else if (cmd === 'taskList') ed.chain().focus().toggleTaskList().run();
    else if (cmd === 'indent') {
      if (ed.isActive('listItem')) ed.chain().focus().sinkListItem('listItem').run();
      else if (ed.isActive('taskItem')) ed.chain().focus().sinkListItem('taskItem').run();
      else word.setParagraphIndent(true);
    } else if (cmd === 'outdent') {
      if (ed.isActive('listItem')) ed.chain().focus().liftListItem('listItem').run();
      else if (ed.isActive('taskItem')) ed.chain().focus().liftListItem('taskItem').run();
      else word.setParagraphIndent(false);
    } else if (cmd === 'clearFormat') {
      ed.chain().focus().unsetAllMarks().clearNodes().run();
    }
    syncRibbonStates();
  }

  function triggerGalleryInsert() {
    onOpenMediaPicker?.({
      type: 'image',
      multiple: true,
      title: '选择多张图片组成并排拼图（2 列）',
      onPickBatch: (list) => {
        if (!list.length) return;
        const cols = list.length >= 3 ? 3 : 2;
        const images = list.map((m) => ({ src: m.url, alt: m.name.replace(/\.[^.]+$/, '') }));
        ed.chain().focus().insertContent({ type: 'imageGallery', attrs: { cols, images } }).run();
        toast(`已插入 ${images.length} 图拼图网格`);
      },
    });
  }

  // ── 绑定 Ribbon 与 Bubble 交互 ──
  document.querySelectorAll('#wordRibbon [data-cmd]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => runFormatCommand(btn.dataset.cmd);
  });
  bubbleMenu.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => { runFormatCommand(btn.dataset.cmd); syncBubbleMenu(); };
  });
  bubbleMenu.querySelectorAll('[data-bubble]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const kind = btn.dataset.bubble;
      if (kind === 'highlight') ed.chain().focus().toggleHighlight({ color: lastHighlightColor }).run();
      else if (kind === 'color') ed.chain().focus().setColor(lastActiveColor).run();
      else if (kind === 'link') promptLinkEdit();
      syncBubbleMenu();
    };
  });

  document.querySelectorAll('#wordRibbon [data-align]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      if (currentView !== 'wysiwyg') {
        insertMarkdownBlock(`<p style="text-align: ${btn.dataset.align}">对齐文本</p>`);
        return;
      }
      ed.chain().focus().setTextAlign(btn.dataset.align).run();
      syncRibbonStates();
    };
  });

  $('#fFmtBlock')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'p') ed.chain().focus().setParagraph().run();
    else if (/^h[1-4]$/.test(v)) ed.chain().focus().setHeading({ level: Number(v[1]) }).run();
    else if (v === 'blockquote') ed.chain().focus().toggleBlockquote().run();
    else if (v === 'codeBlock') ed.chain().focus().toggleCodeBlock().run();
    syncRibbonStates();
  });
  $('#fFmtFont')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) ed.chain().focus().setFontFamily(v).run();
    else ed.chain().focus().unsetFontFamily().run();
  });
  $('#fFmtSize')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) ed.chain().focus().setFontSize(v).run();
    else ed.chain().focus().unsetFontSize().run();
  });
  $('#btnTextIndent')?.addEventListener('click', () => {
    const on = Boolean(ed.getAttributes('paragraph')?.textIndent);
    word.setParagraphIndent(!on);
    syncRibbonStates();
  });
  $('#fLineHeight')?.addEventListener('change', (e) => {
    word.setParagraphLineHeight(e.target.value || null);
    syncRibbonStates();
  });

  const fpBtn = $('#btnFormatPainter');
  if (fpBtn) {
    fpBtn.onmousedown = (e) => e.preventDefault();
    fpBtn.onclick = () => {
      if (word.isFormatPainterActive()) word.clearFormatPainter();
      else { word.captureFormatPainter({ locked: false }); toast('格式刷已开启：拖动选中目标文字即可套用格式'); }
      syncRibbonStates();
    };
    fpBtn.ondblclick = () => {
      word.captureFormatPainter({ locked: true });
      toast('格式刷已连续锁定（再次点击取消）');
      syncRibbonStates();
    };
  }

  buildColorPopover($('#popTextColor'), TEXT_COLORS, {
    defaultCustom: '#ff5a1a',
    onPick: (c) => {
      lastActiveColor = c;
      if ($('#textColorBar')) $('#textColorBar').style.background = c;
      ed.chain().focus().setColor(c).run();
    },
    onClear: () => ed.chain().focus().unsetColor().run(),
  });
  buildColorPopover($('#popHighlightColor'), HIGHLIGHT_COLORS, {
    defaultCustom: '#facc15',
    onPick: (c) => {
      lastHighlightColor = c;
      if ($('#hlColorBar')) $('#hlColorBar').style.background = c;
      ed.chain().focus().setHighlight({ color: c }).run();
    },
    onClear: () => ed.chain().focus().unsetHighlight().run(),
  });
  buildTableGridPopover($('#popTableGrid'));
  buildEmojiPopover($('#popEmoji'));

  const togglePop = (btnId, popId) => {
    $(btnId)?.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $(popId);
      const willOpen = pop?.hidden;
      closeAllPopovers();
      if (pop && willOpen) pop.hidden = false;
    });
  };
  togglePop('#btnTextColor', '#popTextColor');
  togglePop('#btnHighlightColor', '#popHighlightColor');
  togglePop('#btnInsertTable', '#popTableGrid');
  togglePop('#btnInsertCallout', '#popCalloutMenu');
  togglePop('#btnInsertEmoji', '#popEmoji');

  const onDocClickPop = (e) => {
    if (!e.target.closest?.('.ribbon-popover-host')) closeAllPopovers();
  };
  document.addEventListener('click', onDocClickPop);

  $('#popCalloutMenu')?.querySelectorAll('[data-callout-kind]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const kind = btn.dataset.calloutKind;
      const titles = { note: '笔记', tip: '提示', warn: '注意', danger: '警告', quote: '摘录' };
      ed.chain().focus().insertContent({ type: 'callout', attrs: { kind, title: titles[kind] || '' }, content: [{ type: 'paragraph' }] }).run();
      closeAllPopovers();
    };
  });

  function promptLinkEdit() {
    const prev = ed.getAttributes('link')?.href || '';
    const url = window.prompt('输入链接地址（留空则取消链接）：', prev || 'https://');
    if (url === null) return;
    if (!url.trim()) ed.chain().focus().unsetLink().run();
    else ed.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  $('#btnInsertUploadImg')?.addEventListener('click', () => $('#editorMultiImgInput')?.click());
  $('#btnInsertGallery')?.addEventListener('click', triggerGalleryInsert);
  $('#btnInsertDetails')?.addEventListener('click', () => {
    ed.chain().focus().insertContent({
      type: 'details',
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: '点击展开详情' }] },
        { type: 'detailsContent', content: [{ type: 'paragraph' }] },
      ],
    }).run();
  });
  $('#btnInsertMath')?.addEventListener('click', () => onOpenMath?.(true));
  $('#btnInsertAttach')?.addEventListener('click', () => onOpenAttach?.());
  $('#btnInsertBookmark')?.addEventListener('click', () => onOpenBookmark?.());
  $('#btnInsertLink')?.addEventListener('click', promptLinkEdit);
  $('#btnInsertHr')?.addEventListener('click', () => ed.chain().focus().setHorizontalRule().run());
  $('#btnInsertImgSize')?.addEventListener('click', () => onOpenImgSize?.());
  $('#btnInsertVideo')?.addEventListener('click', () => onOpenVideo?.());
  $('#btnInsertMusic')?.addEventListener('click', () => onOpenMusic?.());

  // ── 表格操作栏 ──
  $('#tableContextBar')?.querySelectorAll('[data-tbl]').forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      const act = btn.dataset.tbl;
      const chain = ed.chain().focus();
      if (act === 'addRowBefore') chain.addRowBefore().run();
      else if (act === 'addRowAfter') chain.addRowAfter().run();
      else if (act === 'deleteRow') chain.deleteRow().run();
      else if (act === 'addColBefore') chain.addColumnBefore().run();
      else if (act === 'addColAfter') chain.addColumnAfter().run();
      else if (act === 'deleteCol') chain.deleteColumn().run();
      else if (act === 'toggleHeader') chain.toggleHeaderRow().run();
      else if (act === 'mergeSplit') (ed.can().mergeCells() ? chain.mergeCells() : chain.splitCell()).run();
      else if (act === 'deleteTable') chain.deleteTable().run();
      syncTableBar();
    };
  });

  // ── 查找与替换（同时支持所见即所得 / 分屏 / 源码三视图） ──
  function findSourceMatches(text, query, caseSensitive) {
    const out = [];
    if (!query) return out;
    const hay = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      out.push({ from: idx, to: idx + query.length });
      idx += Math.max(1, query.length);
    }
    return out;
  }

  function selectSourceMatch(index, { focusInput = false } = {}) {
    if (!sourceMatches.length) return;
    sourceActiveIdx = ((index % sourceMatches.length) + sourceMatches.length) % sourceMatches.length;
    const hit = sourceMatches[sourceActiveIdx];
    if (focusInput) sourceInput.focus();
    sourceInput.setSelectionRange(hit.from, hit.to);
    const linesBefore = sourceInput.value.slice(0, hit.from).split('\n').length - 1;
    const lineH = parseFloat(getComputedStyle(sourceInput).lineHeight) || 22;
    sourceInput.scrollTop = Math.max(0, linesBefore * lineH - sourceInput.clientHeight * 0.35);
  }

  function runSourceSearch(query, { selectActive = false } = {}) {
    sourceMatches = findSourceMatches(sourceInput.value, query, sourceCaseSensitive);
    if (sourceActiveIdx >= sourceMatches.length) sourceActiveIdx = 0;
    if (selectActive && sourceMatches.length) selectSourceMatch(sourceActiveIdx);
    updateSearchCounter();
  }

  function runActiveSearch(query, { caseSensitive, selectActive = false } = {}) {
    if (typeof caseSensitive === 'boolean') sourceCaseSensitive = caseSensitive;
    if (currentView === 'wysiwyg') {
      ed.commands.setSearchTerm(query, { caseSensitive: sourceCaseSensitive });
      updateSearchCounter();
    } else {
      runSourceSearch(query, { selectActive });
    }
  }

  function updateSearchCounter() {
    let total = 0;
    let cur = 0;
    if (currentView === 'wysiwyg') {
      const s = ed.storage.searchAndReplace;
      total = s.matches.length;
      cur = total ? s.activeIndex + 1 : 0;
    } else {
      total = sourceMatches.length;
      cur = total ? sourceActiveIdx + 1 : 0;
    }
    if ($('#findCount')) $('#findCount').textContent = `${cur}/${total}`;
  }

  function toggleFindBar(forceOpen, focusReplace = false) {
    const bar = $('#findReplaceBar');
    if (!bar) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : bar.hidden;
    bar.hidden = !open;
    $('#btnFindReplace')?.classList.toggle('primary', open);
    if (open) {
      const qEl = $('#fFindQuery');
      if (qEl) {
        const selText = currentView === 'wysiwyg'
          ? ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, ' ')
          : sourceInput.value.slice(sourceInput.selectionStart || 0, sourceInput.selectionEnd || 0);
        if (selText && selText.length < 60 && !qEl.value) qEl.value = selText;
        runActiveSearch(qEl.value, { selectActive: false });
        setTimeout(() => {
          const target = focusReplace ? $('#fReplaceQuery') : qEl;
          target?.focus();
          target?.select?.();
        }, 0);
      }
    } else {
      sourceMatches = [];
      sourceActiveIdx = 0;
      ed.commands.clearSearch();
      updateSearchCounter();
      (currentView === 'wysiwyg' ? ed.commands.focus() : sourceInput.focus());
    }
  }

  function stepFind(delta) {
    if (currentView === 'wysiwyg') {
      if (delta > 0) ed.commands.findNext();
      else ed.commands.findPrev();
      updateSearchCounter();
      return;
    }
    if (!sourceMatches.length) runSourceSearch($('#fFindQuery')?.value || '', { selectActive: false });
    if (!sourceMatches.length) return;
    selectSourceMatch(sourceActiveIdx + delta);
    updateSearchCounter();
  }

  function replaceOneMatch() {
    if (currentView === 'wysiwyg') {
      ed.commands.replaceCurrent();
      updateSearchCounter();
      return;
    }
    const query = $('#fFindQuery')?.value || '';
    const rep = $('#fReplaceQuery')?.value ?? '';
    if (!sourceMatches.length) runSourceSearch(query, { selectActive: false });
    if (!sourceMatches.length) return;
    const hit = sourceMatches[sourceActiveIdx] || sourceMatches[0];
    sourceInput.setRangeText(rep, hit.from, hit.to, 'end');
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
    runSourceSearch(query, { selectActive: true });
  }

  function replaceAllMatches() {
    if (currentView === 'wysiwyg') {
      const count = ed.storage.searchAndReplace.matches.length;
      ed.commands.replaceAll();
      updateSearchCounter();
      toast(`已替换 ${count} 处`);
      return;
    }
    const query = $('#fFindQuery')?.value || '';
    const rep = $('#fReplaceQuery')?.value ?? '';
    const hits = findSourceMatches(sourceInput.value, query, sourceCaseSensitive);
    if (!hits.length) { toast('没有找到匹配项'); return; }
    let nextVal = sourceInput.value;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      nextVal = nextVal.slice(0, hits[i].from) + rep + nextVal.slice(hits[i].to);
    }
    sourceInput.value = nextVal;
    sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
    runSourceSearch(query, { selectActive: false });
    toast(`已替换 ${hits.length} 处`);
  }

  $('#btnFindReplace')?.addEventListener('click', () => toggleFindBar());
  $('#btnFindClose')?.addEventListener('click', () => toggleFindBar(false));
  $('#fFindQuery')?.addEventListener('input', (e) => { runActiveSearch(e.target.value, { selectActive: false }); });
  $('#fFindQuery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); toggleFindBar(false); }
  });
  $('#fReplaceQuery')?.addEventListener('input', (e) => { ed.commands.setReplaceTerm(e.target.value); });
  $('#fReplaceQuery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOneMatch(); }
    else if (e.key === 'Escape') { e.preventDefault(); toggleFindBar(false); }
  });
  $('#btnFindCase')?.addEventListener('click', (e) => {
    sourceCaseSensitive = !sourceCaseSensitive;
    e.currentTarget.classList.toggle('active', sourceCaseSensitive);
    runActiveSearch($('#fFindQuery')?.value || '', { caseSensitive: sourceCaseSensitive, selectActive: false });
  });
  $('#btnFindNext')?.addEventListener('click', () => stepFind(1));
  $('#btnFindPrev')?.addEventListener('click', () => stepFind(-1));
  $('#btnReplaceOne')?.addEventListener('click', replaceOneMatch);
  $('#btnReplaceAll')?.addEventListener('click', replaceAllMatches);

  // ── 视图切换 / 大纲 / 打字机 / 专注 ──
  $('#viewSwitch')?.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => applyView(btn.dataset.view);
  });
  $('#btnOutline')?.addEventListener('click', () => toggleOutline());
  $('#btnOutlineClose')?.addEventListener('click', () => toggleOutline(false));
  const twBtn = $('#btnTypewriter');
  if (twBtn) {
    twBtn.classList.toggle('primary', typewriterOn);
    twBtn.onclick = () => {
      typewriterOn = !typewriterOn;
      twBtn.classList.toggle('primary', typewriterOn);
      try { localStorage.setItem('admin-typewriter', typewriterOn ? '1' : '0'); } catch { /* ignore */ }
      if (typewriterOn) centerCaretInViewport();
    };
  }
  const focusBtn = $('#btnFocusMode');
  if (focusBtn) {
    focusBtn.classList.toggle('primary', document.body.classList.contains('focus-mode'));
    focusBtn.onclick = () => {
      const on = document.body.classList.toggle('focus-mode');
      focusBtn.classList.toggle('primary', on);
      try { localStorage.setItem('admin-focus-mode', on ? '1' : '0'); } catch { /* ignore */ }
      window.dispatchEvent(new Event('resize'));
    };
  }

  applyView(currentView, { silent: true });
  if (outlineOpen) toggleOutline(true);
  syncRibbonStates();

  return {
    editor: ed,
    getMarkdown,
    setMarkdown,
    getValue: getMarkdown,
    setValue: setMarkdown,
    getHTML: () => ed.getHTML(),
    insertValue: (val) => insertMarkdownBlock(val),
    insertMarkdownBlock,
    insertHtml: (html) => word.insertHtml(html),
    focus: () => (currentView === 'wysiwyg' ? ed.commands.focus() : sourceInput.focus()),
    applyView,
    getView: () => currentView,
    toggleFindBar,
    toggleOutline,
    getSelectedImage: () => {
      const { selection } = ed.state;
      const node = selection.node;
      if (node?.type?.name === 'figureImage') {
        return { ...node.attrs, pos: selection.from };
      }
      return null;
    },
    updateSelectedImage: (pos, attrs) => {
      const cur = ed.state.doc.nodeAt(pos);
      if (!cur || cur.type.name !== 'figureImage') return false;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...attrs }));
      onDirty?.();
      return true;
    },
    replaceImageSrc: (oldUrl, newUrl) => {
      let replaced = false;
      const { state } = ed;
      let tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'figureImage' && node.attrs?.src === oldUrl) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newUrl });
          replaced = true;
        }
      });
      if (replaced) ed.view.dispatch(tr);
      return replaced;
    },
    destroy: () => {
      clearTimeout(previewTimer);
      clearTimeout(outlineTimer);
      clearTimeout(sourceDirtyTimer);
      if (caretRaf) cancelAnimationFrame(caretRaf);
      cachedDoc = null;
      document.removeEventListener('click', onDocClickPop);
      word.destroy();
    },
  };
}

export { markdownToEditorHtml, serializeDocToMarkdown, katex };
