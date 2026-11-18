/**
 * PC 端 Word 级富文本编辑器内核入口（通过 scripts/build-editor-bundle.mjs 打包到 admin/vendor/tiptap-bundle.mjs）。
 * 封装 Tiptap v3 + 自定义节点 + 粘贴清洗 + 查找替换 + 格式刷 + 浮动选区工具栏 + 斜杠命令 + KaTeX 渲染。
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style/text-style-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table/kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Placeholder } from '@tiptap/extensions/placeholder';
import Typography from '@tiptap/extension-typography';
import katex from 'katex';

import {
  ExtendedParagraph,
  ExtendedHeading,
  FigureImage,
  ImageGallery,
  VideoEmbed,
  SongPlayer,
  Callout,
  AttachmentCard,
  BookmarkCard,
  MathInline,
  MathBlock,
} from './custom-nodes.js';
import { cleanPastedHtml } from './paste-cleaner.js';
import { SearchAndReplace } from './search-plugin.js';
import {
  markdownToEditorHtml,
  serializeDocToMarkdown,
  extractOutlineFromDoc,
  countMarkdownStats,
} from '../../../src/lib/editor-codec.mjs';

export {
  markdownToEditorHtml,
  serializeDocToMarkdown,
  extractOutlineFromDoc,
  countMarkdownStats,
  katex,
};

/** 常见斜杠快捷命令定义 */
const SLASH_COMMANDS = [
  { id: 'h2', icon: 'H2', label: '二级标题', desc: '章节主标题', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', icon: 'H3', label: '三级标题', desc: '子小节标题', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'callout-note', icon: '📝', label: '笔记提示框', desc: 'Callout 信息块', run: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { kind: 'note', title: '笔记' }, content: [{ type: 'paragraph' }] }).run() },
  { id: 'callout-warn', icon: '⚠', label: '注意警告框', desc: '重点提醒块', run: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { kind: 'warn', title: '注意' }, content: [{ type: 'paragraph' }] }).run() },
  { id: 'details', icon: '▸', label: '折叠详情块', desc: '可展开/收起内容', run: (e) => e.chain().focus().insertContent({ type: 'details', content: [{ type: 'detailsSummary', content: [{ type: 'text', text: '点击展开详情' }] }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }] }).run() },
  { id: 'table', icon: '⊞', label: '表格 (3×3)', desc: '支持增删行列', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'task', icon: '☑', label: '任务清单', desc: '可勾选待办事项', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', icon: '❝', label: '引用块', desc: '文献或引语', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', icon: '</>', label: '代码块', desc: '代码高亮区块', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', icon: '—', label: '分割线', desc: '水平分隔线', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: 'image', icon: '🖼', label: '上传图片', desc: '本地图片直传图库', action: 'upload-image' },
  { id: 'gallery', icon: '▦', label: '多图拼图网格', desc: '2列/3列并排展示', action: 'insert-gallery' },
  { id: 'video', icon: '▶', label: '插入视频', desc: 'B站/YouTube 或本地 MP4', action: 'insert-video' },
  { id: 'music', icon: '♪', label: '音乐播放条', desc: '音频上传或网易云', action: 'insert-music' },
  { id: 'attachment', icon: '📎', label: 'PDF / 附件卡片', desc: '上传文件并生成下载卡', action: 'insert-attachment' },
  { id: 'math', icon: '∑', label: '数学公式 (LaTeX)', desc: '块级公式渲染', action: 'insert-math-block' },
  { id: 'bookmark', icon: '🔖', label: '网页书签卡片', desc: '抓取标题生成卡片', action: 'insert-bookmark' },
];

export function createWordEditor({
  element,
  initialMarkdown = '',
  onUpdate,
  onSelectionUpdate,
  onUploadImages,
  onImportExternalImages,
  onNodeAction,
  onSlashAction,
  onShortcutSave,
  onShortcutFind,
} = {}) {
  let formatPainter = null; // { marks: [{type, attrs}], blockAttrs: {}, locked: false }
  let slashMenuEl = null;
  let slashActiveIdx = 0;
  let slashQuery = '';
  let slashRange = null;

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        paragraph: false,
        heading: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
        dropcursor: { color: '#ff5a1a', width: 2 },
      }),
      ExtendedParagraph,
      ExtendedHeading,
      TextStyleKit.configure({ lineHeight: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      Subscript,
      Superscript,
      TableKit.configure({ table: { resizable: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Typography,
      Placeholder.configure({ placeholder: '开始写作… 输入 / 唤出快捷插入菜单，支持直接粘贴 Word 文档与截图' }),
      SearchAndReplace,
      FigureImage.configure({ onAction: (action, payload) => onNodeAction?.(action, payload) }),
      ImageGallery.configure({ onAction: (action, payload) => onNodeAction?.(action, payload) }),
      VideoEmbed,
      SongPlayer,
      Callout,
      AttachmentCard,
      BookmarkCard,
      MathInline,
      MathBlock,
    ],
    content: markdownToEditorHtml(initialMarkdown),
    editorProps: {
      attributes: {
        class: 'acr-prosemirror prose',
        spellcheck: 'false',
      },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          onShortcutSave?.();
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'h')) {
          event.preventDefault();
          onShortcutFind?.(event.key.toLowerCase() === 'h');
          return true;
        }
        if (slashMenuEl && !slashMenuEl.hidden) {
          const items = filteredSlashCommands();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            slashActiveIdx = (slashActiveIdx + 1) % Math.max(1, items.length);
            renderSlashItems();
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            slashActiveIdx = (slashActiveIdx - 1 + Math.max(1, items.length)) % Math.max(1, items.length);
            renderSlashItems();
            return true;
          }
          if (event.key === 'Enter' && items.length) {
            event.preventDefault();
            executeSlashCommand(items[slashActiveIdx]);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            hideSlashMenu();
            return true;
          }
        }
        return false;
      },
      handlePaste(view, event) {
        const dt = event.clipboardData;
        if (!dt) return false;
        const files = [...(dt.files || [])];
        const imgFiles = files.filter((f) => f.type.startsWith('image/'));
        if (imgFiles.length) {
          event.preventDefault();
          onUploadImages?.(imgFiles);
          return true;
        }
        const html = dt.getData('text/html');
        if (html) {
          const { html: cleaned, externalImages } = cleanPastedHtml(html);
          if (cleaned) {
            event.preventDefault();
            editor.commands.insertContent(cleaned, { parseOptions: { preserveWhitespace: false } });
            if (externalImages.length) onImportExternalImages?.(externalImages);
            return true;
          }
        }
        return false;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files || [])];
        const imgFiles = files.filter((f) => f.type.startsWith('image/'));
        if (imgFiles.length) {
          event.preventDefault();
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (coords?.pos) editor.commands.setTextSelection(coords.pos);
          onUploadImages?.(imgFiles);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      updateSlashMenuState(ed);
      onUpdate?.(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      updateSlashMenuState(ed);
      onSelectionUpdate?.(ed);
    },
  });

  // ── 斜杠 `/` 快捷命令浮层 ──
  function ensureSlashMenu() {
    if (slashMenuEl) return slashMenuEl;
    slashMenuEl = document.createElement('div');
    slashMenuEl.className = 'acr-slash-menu';
    slashMenuEl.hidden = true;
    document.body.appendChild(slashMenuEl);
    return slashMenuEl;
  }

  function filteredSlashCommands() {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.id.includes(q));
  }

  function renderSlashItems() {
    const menu = ensureSlashMenu();
    const items = filteredSlashCommands();
    if (!items.length) {
      menu.innerHTML = '<div class="acr-slash-empty">没有匹配的命令</div>';
      return;
    }
    menu.innerHTML = '';
    items.forEach((cmd, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `acr-slash-item${idx === slashActiveIdx ? ' active' : ''}`;
      btn.innerHTML = `<span class="acr-slash-icon">${cmd.icon}</span><span class="acr-slash-text"><b>${cmd.label}</b><small>${cmd.desc}</small></span>`;
      btn.onmousedown = (e) => { e.preventDefault(); executeSlashCommand(cmd); };
      menu.appendChild(btn);
    });
  }

  function executeSlashCommand(cmd) {
    if (!cmd) return;
    const range = slashRange;
    hideSlashMenu();
    if (range) editor.chain().focus().deleteRange(range).run();
    if (cmd.run) cmd.run(editor);
    else if (cmd.action) onSlashAction?.(cmd.action);
  }

  function hideSlashMenu() {
    if (slashMenuEl) slashMenuEl.hidden = true;
    slashRange = null;
    slashQuery = '';
  }

  function updateSlashMenuState(ed) {
    const { state } = ed;
    const { selection } = state;
    if (!selection.empty) { hideSlashMenu(); return; }
    const $from = selection.$from;
    const parent = $from.parent;
    if (parent.type.name !== 'paragraph') { hideSlashMenu(); return; }
    const textBefore = parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const match = textBefore.match(/^\/([a-z0-9\u4e00-\u9fff-]*)$/i);
    if (!match) { hideSlashMenu(); return; }
    slashQuery = match[1] || '';
    slashActiveIdx = 0;
    slashRange = { from: $from.start(), to: $from.pos };
    const menu = ensureSlashMenu();
    renderSlashItems();
    const coords = ed.view.coordsAtPos($from.pos);
    menu.hidden = false;
    const left = Math.min(window.innerWidth - 260, Math.max(12, coords.left));
    const top = Math.min(window.innerHeight - 280, coords.bottom + 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  // ── 格式刷（Word 同款：点一次应用一次，双击连续锁定） ──
  function captureFormatPainter({ locked = false } = {}) {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    const marks = (empty ? (state.storedMarks || state.selection.$from.marks()) : state.selection.$from.marks()).map((m) => ({
      type: m.type.name,
      attrs: { ...(m.attrs || {}) },
    }));
    const parent = state.selection.$from.parent;
    const blockAttrs = {
      textAlign: parent.attrs?.textAlign || 'left',
      textIndent: Boolean(parent.attrs?.textIndent),
      lineHeight: parent.attrs?.lineHeight || null,
    };
    formatPainter = { marks, blockAttrs, locked, armedFrom: from, armedTo: to };
    editor.view.dom.classList.add('acr-format-painter');
    return formatPainter;
  }

  function clearFormatPainter() {
    formatPainter = null;
    editor.view.dom.classList.remove('acr-format-painter');
  }

  function applyFormatPainterIfArmed() {
    if (!formatPainter) return false;
    const fp = formatPainter;
    const { state } = editor;
    if (state.selection.empty && state.selection.from === fp.armedFrom) return false;
    let chain = editor.chain().focus().unsetAllMarks();
    for (const m of fp.marks) {
      chain = chain.setMark(m.type, m.attrs);
    }
    if (fp.blockAttrs.textAlign) chain = chain.setTextAlign(fp.blockAttrs.textAlign);
    chain.updateAttributes('paragraph', {
      textIndent: fp.blockAttrs.textIndent,
      lineHeight: fp.blockAttrs.lineHeight,
    }).run();
    if (!fp.locked) clearFormatPainter();
    return true;
  }

  const onEditorMouseUp = () => {
    if (formatPainter) setTimeout(() => applyFormatPainterIfArmed(), 0);
  };
  editor.view.dom.addEventListener('mouseup', onEditorMouseUp);

  return {
    editor,
    getMarkdown: () => serializeDocToMarkdown(editor.getJSON()),
    setMarkdown: (md) => {
      editor.commands.setContent(markdownToEditorHtml(md), { emitUpdate: false });
    },
    getHTML: () => editor.getHTML(),
    insertMarkdownBlock: (md) => {
      const html = markdownToEditorHtml(md);
      editor.chain().focus().insertContent(html).run();
    },
    insertHtml: (html) => {
      editor.chain().focus().insertContent(html).run();
    },
    focus: () => editor.commands.focus(),
    getOutline: () => extractOutlineFromDoc(editor.getJSON()),
    captureFormatPainter,
    clearFormatPainter,
    isFormatPainterActive: () => Boolean(formatPainter),
    setParagraphIndent: (on) => editor.chain().focus().updateAttributes('paragraph', { textIndent: Boolean(on) }).run(),
    setParagraphLineHeight: (lh) => editor.chain().focus().updateAttributes('paragraph', { lineHeight: lh || null }).run(),
    destroy: () => {
      editor.view.dom.removeEventListener('mouseup', onEditorMouseUp);
      if (slashMenuEl) slashMenuEl.remove();
      editor.destroy();
    },
  };
}
