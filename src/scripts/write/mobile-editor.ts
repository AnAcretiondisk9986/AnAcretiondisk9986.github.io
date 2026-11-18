/**
 * 手机端发文助手（/write/）主控制器：
 * - visualViewport 贴合虚拟键盘，防止工具栏被软键盘遮挡或闪烁
 * - Tiptap 轻量化所见即所得 + 一键切 Markdown 源码（IME 友好、触控大按钮）
 * - 本地草稿即时防丢（localStorage） + 多图相册压缩直传 blog-images + 即时 blob 本地预览
 */
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions/placeholder';
import {
  markdownToEditorHtml,
  serializeDocToMarkdown,
  countMarkdownStats,
} from '../../lib/editor-codec.mjs';
import {
  type PostMeta,
  localToday,
  parsePostFile,
  serializePostFile,
  slugifyTitle,
} from './frontmatter';
import {
  loadAuthConfig,
  saveAuthConfig,
  isConfigured,
  loginWorker,
  listBlogFiles,
  readBlogFile,
  saveBlogFile,
  deleteBlogFile,
  uploadImageToRepo,
  getLatestDeployRun,
  type RemoteBlogEntry,
} from './github-client';
import { createMobileDailyController } from './mobile-daily';

const DRAFT_PREFIX = 'hz-write-draft:';
const WRITE_MODE_KEY = 'hz-write-mode-v1';

/** 手机端轻量图片节点：保留对齐与宽度，同时支持刚上传时用 blobUrl 立即预览而不污染 CDN src */
const previewBlobMap = new Map<string, string>();

const MobileFigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: '' },
      align: { default: 'center' },
      caption: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure.hz-figure',
        getAttrs: (el: HTMLElement) => {
          const img = el.querySelector('img');
          if (!img) return false;
          return {
            src: img.getAttribute('src') || '',
            alt: img.getAttribute('alt') || '',
            width: el.style?.width || img.style?.width || '',
            align: el.getAttribute('data-align') || 'center',
            caption: el.querySelector('figcaption')?.textContent || '',
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute('src') || '',
          alt: el.getAttribute('alt') || '',
          width: el.style?.width || '',
          align: el.getAttribute('data-align') || 'none',
          caption: '',
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt || '' }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrap = document.createElement('div');
      wrap.className = 'mw-img-block';
      const img = document.createElement('img');
      const actions = document.createElement('div');
      actions.className = 'mw-img-actions';

      const mk = (text: string, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.onpointerdown = (e) => { e.preventDefault(); };
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        return b;
      };
      const patch = (next: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...next }));
      };

      actions.append(
        mk('50%', () => patch({ width: '50%' })),
        mk('75%', () => patch({ width: '75%' })),
        mk('全宽', () => patch({ width: '' })),
        mk('居中', () => patch({ align: 'center' })),
        mk('删图', () => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        }),
      );
      wrap.append(img, actions);

      const sync = (n: typeof node) => {
        const src = n.attrs?.src || '';
        img.src = previewBlobMap.get(src) || src;
        img.alt = n.attrs?.alt || '';
        img.style.width = n.attrs?.width || '100%';
        wrap.dataset.align = n.attrs?.align || 'center';
      };
      sync(node);

      return {
        dom: wrap,
        update: (updated) => {
          if (updated.type !== this.type) return false;
          node = updated;
          sync(updated);
          return true;
        },
      };
    };
  },
});

const MobileVideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{
      tag: 'div.video-embed',
      getAttrs: (el: HTMLElement) => {
        const v = el.querySelector('video');
        if (v) return { kind: 'video', src: v.getAttribute('src') || '' };
        const f = el.querySelector('iframe');
        return f ? { kind: 'iframe', src: f.getAttribute('src') || '' } : false;
      },
    }];
  },
  addAttributes() {
    return { kind: { default: 'iframe' }, src: { default: '' } };
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'video-embed' }, HTMLAttributes.src];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'mw-embed-pill';
      const label = document.createElement('span');
      label.textContent = `▶ 视频：${(node.attrs?.src || '').slice(0, 42)}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.onclick = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      dom.append(label, del);
      return { dom };
    };
  },
});

const MobileSongPlayer = Node.create({
  name: 'songPlayer',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{
      tag: 'div.song-player',
      getAttrs: (el: HTMLElement) => ({
        src: el.getAttribute('data-src') || el.querySelector('a')?.getAttribute('href') || '',
        title: el.getAttribute('data-title') || '',
        artist: el.getAttribute('data-artist') || '',
        cover: el.getAttribute('data-cover') || '',
      }),
    }];
  },
  addAttributes() {
    return { src: { default: '' }, title: { default: '' }, artist: { default: '' }, cover: { default: '' } };
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'song-player', 'data-src': HTMLAttributes.src || '' }, '♪ 播放音频'];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'mw-embed-pill';
      const label = document.createElement('span');
      label.textContent = `♪ 音乐：${node.attrs?.title || node.attrs?.src || '音频'}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.onclick = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      dom.append(label, del);
      return { dom };
    };
  },
});

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

function showToast(msg: string) {
  const el = $('#mwToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout((el as unknown as { _t?: number })._t);
  (el as unknown as { _t?: number })._t = window.setTimeout(() => el.classList.remove('show'), 2800);
}

export function initMobileWriteApp() {
  const shell = $('#mwShell');
  const proseHost = $('#mwProseHost');
  const sourceTextarea = $('#mwSourceInput') as HTMLTextAreaElement | null;
  const titleInput = $('#mwTitle') as HTMLInputElement | null;
  if (!shell || !proseHost || !sourceTextarea || !titleInput) return;

  let currentFilename: string | null = null; // null 表示新建
  let currentSha = '';
  let currentSlugEdited = false;
  let editorMode: 'wysiwyg' | 'source' = 'wysiwyg';
  let composeMode: 'post' | 'daily' = 'post';
  let remotePosts: RemoteBlogEntry[] = [];
  let draftTimer = 0;
  let dirty = false;

  function setHeaderBadges(draftText: string, statsText: string) {
    const st = $('#mwDraftStatus');
    const sc = $('#mwStatsChip');
    if (st) st.textContent = draftText;
    if (sc) sc.textContent = statsText;
  }

  let meta: PostMeta = {
    title: '',
    description: '',
    pubDate: localToday(),
    cover: '',
    dayIndex: '',
    tags: [],
    draft: false,
    archived: false,
    scheduledAt: '',
    access: 'public',
    extra: {},
  };

  // ── 1. 绑定 visualViewport：保证底部格式条紧贴虚拟键盘上方 ──
  const syncViewportHeight = () => {
    const vv = window.visualViewport;
    if (vv) {
      shell.style.height = `${Math.round(vv.height)}px`;
      shell.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`;
    } else {
      shell.style.height = `${window.innerHeight}px`;
      shell.style.transform = '';
    }
  };
  syncViewportHeight();
  window.visualViewport?.addEventListener('resize', syncViewportHeight);
  window.visualViewport?.addEventListener('scroll', syncViewportHeight);
  window.addEventListener('resize', syncViewportHeight);

  // ── 2. 初始化轻量化手机 Tiptap 实例 ──
  const tiptap = new Editor({
    element: proseHost,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
        dropcursor: false,
      }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      MobileFigureImage,
      MobileVideoEmbed,
      MobileSongPlayer,
      Placeholder.configure({ placeholder: '在这里写点什么… 支持加粗、高亮、居中、列表和拍照传图' }),
    ],
    content: '<p></p>',
    editorProps: {
      attributes: { class: 'mw-prosemirror', spellcheck: 'false' },
    },
    onUpdate: () => {
      markDirty();
      updateStats();
    },
    onSelectionUpdate: () => {
      syncToolbarActive();
    },
  });

  function getBodyMarkdown(): string {
    if (editorMode === 'source') return sourceTextarea?.value || '';
    return serializeDocToMarkdown(tiptap.getJSON());
  }

  function setBodyMarkdown(md: string) {
    if (sourceTextarea) sourceTextarea.value = md;
    tiptap.commands.setContent(markdownToEditorHtml(md), { emitUpdate: false });
    updateStats();
  }

  function draftKey(filename = currentFilename) {
    return `${DRAFT_PREFIX}${filename || '__new__'}`;
  }

  function saveLocalDraftNow() {
    if (!dirty) return;
    const payload = {
      updatedAt: Date.now(),
      sha: currentSha,
      slug: ($('#mwSlug') as HTMLInputElement | null)?.value || '',
      meta: { ...meta, title: titleInput?.value || '' },
      content: getBodyMarkdown(),
    };
    try { localStorage.setItem(draftKey(), JSON.stringify(payload)); } catch { /* ignore */ }
    if (composeMode === 'post') {
      const badge = $('#mwDraftStatus');
      if (badge) badge.textContent = '已本地暂存';
    }
  }

  function clearLocalDraft(filename = currentFilename) {
    try { localStorage.removeItem(draftKey(filename)); } catch { /* ignore */ }
  }

  function markDirty() {
    dirty = true;
    if (composeMode === 'post') {
      const badge = $('#mwDraftStatus');
      if (badge) badge.textContent = '未发布';
    }
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveLocalDraftNow, 300);
  }

  function updateStats() {
    if (composeMode !== 'post') return;
    const stats = countMarkdownStats(getBodyMarkdown());
    const el = $('#mwStatsChip');
    if (el) el.textContent = `${stats.chars} 字`;
  }

  function syncMetaSummary() {
    const accessLabel = meta.access === 'admin' ? '私密' : meta.access === 'authorized' ? '授权' : '公开';
    const stateLabel = meta.draft ? '草稿' : '发布';
    const tagsLabel = meta.tags.length ? ` · ${meta.tags.slice(0, 2).join(', ')}` : '';
    const chip = $('#mwMetaSummary');
    if (chip) chip.textContent = `${accessLabel} · ${stateLabel}${tagsLabel} ▾`;
  }

  function syncToolbarActive() {
    if (editorMode !== 'wysiwyg') return;
    const setAct = (sel: string, active: boolean) => $(sel)?.classList.toggle('active', active);
    setAct('[data-mcmd="bold"]', tiptap.isActive('bold'));
    setAct('[data-mcmd="highlight"]', tiptap.isActive('highlight'));
    setAct('[data-mcmd="heading"]', tiptap.isActive('heading'));
    setAct('[data-mcmd="center"]', tiptap.isActive({ textAlign: 'center' }));
    setAct('[data-mcmd="quote"]', tiptap.isActive('blockquote'));
    setAct('[data-mcmd="bullet"]', tiptap.isActive('bulletList'));
    setAct('[data-mcmd="task"]', tiptap.isActive('taskList'));
  }

  // ── 3. 底部吸顶工具栏按钮（用 pointerdown preventDefault 保持键盘不收起）──
  document.querySelectorAll('#mwAccessoryBar [data-mcmd]').forEach((btn) => {
    const el = btn as HTMLElement;
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      const cmd = el.dataset.mcmd;
      if (cmd === 'source') {
        if (editorMode === 'wysiwyg') {
          if (sourceTextarea) sourceTextarea.value = serializeDocToMarkdown(tiptap.getJSON());
          editorMode = 'source';
          proseHost.hidden = true;
          if (sourceTextarea) sourceTextarea.hidden = false;
          el.classList.add('active');
          sourceTextarea?.focus();
        } else {
          tiptap.commands.setContent(markdownToEditorHtml(sourceTextarea?.value || ''), { emitUpdate: false });
          editorMode = 'wysiwyg';
          if (sourceTextarea) sourceTextarea.hidden = true;
          proseHost.hidden = false;
          el.classList.remove('active');
          tiptap.commands.focus();
        }
        return;
      }

      if (editorMode === 'source') {
        const snippets: Record<string, string> = {
          bold: '**加粗文字**',
          highlight: '<mark>高亮</mark>',
          heading: '\n## 小标题\n',
          center: '\n<p style="text-align: center">居中文本</p>\n',
          quote: '\n> 引用内容\n',
          bullet: '\n- 列表项\n',
          task: '\n- [ ] 待办事项\n',
        };
        const text = snippets[cmd || ''];
        if (text && sourceTextarea) {
          const s = sourceTextarea.selectionStart ?? sourceTextarea.value.length;
          const e = sourceTextarea.selectionEnd ?? s;
          sourceTextarea.setRangeText(text, s, e, 'end');
          markDirty();
          updateStats();
        }
        return;
      }

      if (cmd === 'bold') tiptap.chain().focus().toggleBold().run();
      else if (cmd === 'highlight') tiptap.chain().focus().toggleHighlight({ color: 'rgba(255, 90, 26, 0.32)' }).run();
      else if (cmd === 'heading') {
        if (tiptap.isActive('heading', { level: 2 })) tiptap.chain().focus().setHeading({ level: 3 }).run();
        else if (tiptap.isActive('heading', { level: 3 })) tiptap.chain().focus().setParagraph().run();
        else tiptap.chain().focus().setHeading({ level: 2 }).run();
      } else if (cmd === 'center') {
        const nextAlign = tiptap.isActive({ textAlign: 'center' }) ? 'left' : 'center';
        tiptap.chain().focus().setTextAlign(nextAlign).run();
      } else if (cmd === 'quote') tiptap.chain().focus().toggleBlockquote().run();
      else if (cmd === 'bullet') tiptap.chain().focus().toggleBulletList().run();
      else if (cmd === 'task') tiptap.chain().focus().toggleTaskList().run();
      else if (cmd === 'link') {
        const url = window.prompt('输入超链接地址：', 'https://');
        if (url && url.trim()) tiptap.chain().focus().setLink({ href: url.trim() }).run();
      } else if (cmd === 'undo') tiptap.chain().focus().undo().run();
      else if (cmd === 'redo') tiptap.chain().focus().redo().run();
      syncToolbarActive();
    });
  });

  sourceTextarea.addEventListener('input', () => { markDirty(); updateStats(); });

  titleInput.addEventListener('input', () => {
    meta.title = titleInput.value;
    const slugEl = $('#mwSlug') as HTMLInputElement | null;
    if (!currentFilename && !currentSlugEdited && slugEl) {
      slugEl.value = slugifyTitle(titleInput.value);
    }
    markDirty();
  });

  // ── 4. 手机相册/拍照多图直传 ──
  const photoInput = $('#mwPhotoInput') as HTMLInputElement | null;
  $('#btnMwPhoto')?.addEventListener('pointerdown', (e) => e.preventDefault());
  $('#btnMwPhoto')?.addEventListener('click', () => photoInput?.click());

  photoInput?.addEventListener('change', async () => {
    const files = [...(photoInput.files || [])];
    photoInput.value = '';
    if (!files.length) return;
    if (!isConfigured()) {
      showToast('请先配置 GitHub Token 或 Worker 登录');
      openSheet('#mwSettingsSheet');
      return;
    }

    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      showToast(`压缩并上传图片 (${i + 1}/${files.length})…`);
      try {
        const { url, previewUrl, filename } = await uploadImageToRepo(f);
        previewBlobMap.set(url, previewUrl);
        if (editorMode === 'source' && sourceTextarea) {
          const s = sourceTextarea.selectionStart ?? sourceTextarea.value.length;
          sourceTextarea.setRangeText(`\n![${filename.replace(/\.[^.]+$/, '')}](${url})\n`, s, s, 'end');
        } else {
          tiptap.chain().focus().insertContent({
            type: 'figureImage',
            attrs: { src: url, alt: filename.replace(/\.[^.]+$/, ''), align: 'center' },
          }).run();
        }
        markDirty();
        updateStats();
        showToast('图片已插入');
      } catch (err) {
        showToast(`上传失败：${(err as Error).message}`);
      }
    }
  });

  // ── 5. 音视频快捷插入 Sheet ──
  $('#btnMwMedia')?.addEventListener('click', () => openSheet('#mwMediaSheet'));
  $('#btnMwInsertVideo')?.addEventListener('click', () => {
    const raw = (($('#mwVideoUrl') as HTMLInputElement | null)?.value || '').trim();
    if (!raw) { showToast('请输入 B站 / YouTube 或 MP4 地址'); return; }
    let html = '';
    const bv = raw.match(/(BV[0-9A-Za-z]{10})/i);
    const yt = raw.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
    if (bv) html = `<div class="video-embed"><iframe src="https://player.bilibili.com/player.html?bvid=${bv[1]}&page=1&high_quality=1&autoplay=0" allowfullscreen="true" loading="lazy"></iframe></div>`;
    else if (yt) html = `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allowfullscreen loading="lazy"></iframe></div>`;
    else if (/^https?:\/\/.+\.(?:mp4|webm|mov)(?:[?#].*)?$/i.test(raw)) html = `<div class="video-embed"><video controls preload="metadata" src="${raw}"></video></div>`;
    else { showToast('仅支持 B站 BV 号、YouTube 链接或 MP4 直链'); return; }
    insertBlockIntoMobileEditor(html);
    closeSheets();
    showToast('已插入视频');
  });
  $('#btnMwInsertAudio')?.addEventListener('click', () => {
    const src = (($('#mwAudioUrl') as HTMLInputElement | null)?.value || '').trim();
    const title = (($('#mwAudioTitle') as HTMLInputElement | null)?.value || '').trim();
    if (!/^https?:\/\//i.test(src)) { showToast('请输入有效音频直链'); return; }
    const html = `<div class="song-player" data-src="${src}"${title ? ` data-title="${title}"` : ''}><a href="${src}">♪ 播放音频</a></div>`;
    insertBlockIntoMobileEditor(html);
    closeSheets();
    showToast('已插入音乐播放条');
  });

  function insertBlockIntoMobileEditor(htmlOrMd: string) {
    if (editorMode === 'source' && sourceTextarea) {
      const s = sourceTextarea.selectionStart ?? sourceTextarea.value.length;
      sourceTextarea.setRangeText(`\n${htmlOrMd}\n`, s, s, 'end');
    } else {
      tiptap.chain().focus().insertContent(markdownToEditorHtml(htmlOrMd)).run();
    }
    markDirty();
    updateStats();
  }

  // ── 6. 滑出面板控制（文章列表 / 元数据 / 设置 / 音视频）──
  function closeSheets() {
    document.querySelectorAll('.mw-sheet-mask').forEach((m) => { (m as HTMLElement).hidden = true; });
  }
  function openSheet(sel: string) {
    closeSheets();
    const el = $(sel);
    if (el) el.hidden = false;
  }
  document.querySelectorAll('.mw-sheet-mask').forEach((mask) => {
    mask.addEventListener('click', (e) => { if (e.target === mask) closeSheets(); });
  });
  document.querySelectorAll('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheets));

  // 元数据表单读写
  function fillMetaForm() {
    const set = (id: string, v: string) => { const el = $(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; if (el) el.value = v; };
    set('#mwSlug', currentFilename ? currentFilename.replace(/\.(md|mdx)$/i, '') : slugifyTitle(titleInput.value));
    set('#mwDesc', meta.description || '');
    set('#mwTags', meta.tags.join(', '));
    set('#mwDate', meta.pubDate || localToday());
    set('#mwAccess', meta.access || 'public');
    set('#mwCover', meta.cover || '');
    const draftChk = $('#mwDraftCheck') as HTMLInputElement | null;
    if (draftChk) draftChk.checked = Boolean(meta.draft);
    const delBtn = $('#btnMwDeletePost');
    if (delBtn) delBtn.hidden = !currentFilename;
  }

  function readMetaForm() {
    const val = (id: string) => (($(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
    meta.title = titleInput.value.trim();
    meta.description = val('#mwDesc');
    meta.tags = val('#mwTags').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    meta.pubDate = val('#mwDate') || localToday();
    meta.access = (val('#mwAccess') as PostMeta['access']) || 'public';
    meta.cover = val('#mwCover');
    meta.draft = Boolean(($('#mwDraftCheck') as HTMLInputElement | null)?.checked);
    syncMetaSummary();
  }

  $('#mwMetaSummary')?.addEventListener('click', () => { fillMetaForm(); openSheet('#mwMetaSheet'); });
  $('#mwSlug')?.addEventListener('input', () => { currentSlugEdited = true; markDirty(); });
  ['#mwDesc', '#mwTags', '#mwDate', '#mwAccess', '#mwCover', '#mwDraftCheck'].forEach((id) => {
    $(id)?.addEventListener('change', () => { readMetaForm(); markDirty(); });
  });

  // 封面传图
  const coverPhotoInput = $('#mwCoverPhotoInput') as HTMLInputElement | null;
  $('#btnMwUploadCover')?.addEventListener('click', () => coverPhotoInput?.click());
  coverPhotoInput?.addEventListener('change', async () => {
    const f = coverPhotoInput.files?.[0];
    coverPhotoInput.value = '';
    if (!f) return;
    showToast('压缩并上传封面…');
    try {
      const { url } = await uploadImageToRepo(f);
      const coverEl = $('#mwCover') as HTMLInputElement | null;
      if (coverEl) coverEl.value = url;
      readMetaForm();
      markDirty();
      showToast('封面已上传');
    } catch (e) { showToast(`封面上传失败：${(e as Error).message}`); }
  });

  // ── 7. 远端文章列表 & 读取 & 新建 & 删除 ──
  function startNewPost(checkGuard = true) {
    if (checkGuard && dirty && !window.confirm('当前文章尚未发布到仓库（本地已暂存），确认新建空白文章？')) return;
    currentFilename = null;
    currentSha = '';
    currentSlugEdited = false;
    meta = {
      title: '', description: '', pubDate: localToday(), cover: '', dayIndex: '',
      tags: [], draft: false, archived: false, scheduledAt: '', access: 'public', extra: {},
    };
    titleInput.value = '';
    setBodyMarkdown('');
    fillMetaForm();
    syncMetaSummary();
    dirty = false;
    const badge = $('#mwDraftStatus');
    if (badge) badge.textContent = '新文章';
    restoreDraftIfAny();
    closeSheets();
  }

  function restoreDraftIfAny() {
    try {
      const raw = localStorage.getItem(draftKey());
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || (!d.content && !d.meta?.title)) return;
      const t = d.updatedAt ? new Date(d.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      if (!window.confirm(`发现未发布的本地暂存草稿（${t}），是否恢复？`)) {
        clearLocalDraft();
        return;
      }
      meta = { ...meta, ...(d.meta || {}) };
      titleInput.value = meta.title || '';
      if (d.slug && $('#mwSlug')) ($('#mwSlug') as HTMLInputElement).value = d.slug;
      setBodyMarkdown(d.content || '');
      syncMetaSummary();
      dirty = true;
      const badge = $('#mwDraftStatus');
      if (badge) badge.textContent = '已恢复草稿';
    } catch { /* ignore */ }
  }

  async function openPostList() {
    openSheet('#mwPostsSheet');
    const listEl = $('#mwPostsList');
    if (!isConfigured()) {
      if (listEl) listEl.innerHTML = '<div class="mw-empty">请先点右上角「设置」连接 GitHub</div>';
      return;
    }
    if (listEl) listEl.innerHTML = '<div class="mw-empty">读取仓库文章列表…</div>';
    try {
      remotePosts = await listBlogFiles();
      renderPostList('');
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="mw-empty">读取失败：${(err as Error).message}</div>`;
    }
  }

  function renderPostList(q: string) {
    const listEl = $('#mwPostsList');
    if (!listEl) return;
    const needle = q.trim().toLowerCase();
    const items = remotePosts.filter((p) => !needle || p.slug.toLowerCase().includes(needle));
    if (!items.length) {
      listEl.innerHTML = '<div class="mw-empty">没有匹配的文章</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mw-post-row${currentFilename === item.name ? ' active' : ''}`;
      btn.textContent = item.slug;
      btn.onclick = () => loadRemotePost(item.name);
      listEl.appendChild(btn);
    });
  }

  async function loadRemotePost(filename: string) {
    if (dirty && !window.confirm('当前有未发布修改，确认切换文章？')) return;
    showToast('加载文章中…');
    try {
      const { raw, sha } = await readBlogFile(filename);
      const parsed = parsePostFile(raw);
      currentFilename = filename;
      currentSha = sha;
      currentSlugEdited = true;
      meta = parsed.meta;
      titleInput.value = meta.title || '';
      setBodyMarkdown(parsed.content || '');
      fillMetaForm();
      syncMetaSummary();
      dirty = false;
      const badge = $('#mwDraftStatus');
      if (badge) badge.textContent = '已同步';
      closeSheets();
      restoreDraftIfAny();
    } catch (err) {
      showToast(`读取失败：${(err as Error).message}`);
    }
  }

  const dailyCtrl = createMobileDailyController({
    openSheet,
    closeSheets,
    showToast,
    isDailyActive: () => composeMode === 'daily',
    updateHeaderBadges: setHeaderBadges,
    pollBuildProgress: (url) => pollBuildProgress(url),
  });

  $('#btnMwPosts')?.addEventListener('click', () => (
    composeMode === 'daily' ? dailyCtrl.openDrawerList() : openPostList()
  ));
  $('#btnMwNewPost')?.addEventListener('click', () => (
    composeMode === 'daily' ? dailyCtrl.startNewMoment(true) : startNewPost(true)
  ));
  $('#mwPostsSearch')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value;
    if (composeMode === 'daily') dailyCtrl.renderDrawerList(q);
    else renderPostList(q);
  });

  $('#btnMwDeletePost')?.addEventListener('click', async () => {
    if (!currentFilename || !currentSha) return;
    if (!window.confirm(`确定从 GitHub 删除「${currentFilename}」？`)) return;
    try {
      await deleteBlogFile({ filename: currentFilename, sha: currentSha, message: `mobile delete ${currentFilename}` });
      clearLocalDraft(currentFilename);
      showToast('已从仓库删除');
      startNewPost(false);
    } catch (err) {
      showToast(`删除失败：${(err as Error).message}`);
    }
  });

  // ── 8. 发布上线（提交到 GitHub main + 轮询 Actions 构建状态）──
  async function publishToGitHub({ asDraft = false } = {}) {
    if (!isConfigured()) {
      showToast('请先配置 GitHub 连接');
      openSheet('#mwSettingsSheet');
      return;
    }
    readMetaForm();
    if (!meta.title.trim()) { showToast('请先输入文章标题'); titleInput.focus(); return; }

    meta.draft = asDraft;
    syncMetaSummary();

    const slugVal = (($('#mwSlug') as HTMLInputElement | null)?.value || '').trim() || slugifyTitle(meta.title) || `post-${Date.now()}`;
    const filename = currentFilename || `${slugVal}.md`;
    const bodyMd = getBodyMarkdown();
    const rawMarkdown = serializePostFile(meta, bodyMd);

    const pubBtn = $('#btnMwPublish') as HTMLButtonElement | null;
    if (pubBtn) { pubBtn.disabled = true; pubBtn.textContent = '推送中…'; }

    try {
      const saved = await saveBlogFile({
        filename,
        rawMarkdown,
        sha: currentSha || undefined,
        message: `${currentFilename ? 'mobile update' : 'mobile publish'}: ${meta.title}`,
      });
      currentFilename = filename;
      currentSha = saved.sha;
      dirty = false;
      clearLocalDraft(filename);
      clearLocalDraft(null);
      const badge = $('#mwDraftStatus');
      if (badge) badge.textContent = asDraft ? '草稿已推' : '已推送';
      showToast(asDraft ? '草稿已保存到 GitHub' : '已推送到 main，GitHub Actions 构建中…');
      closeSheets();
      pollBuildProgress();
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409 || e.status === 422) {
        showToast('仓库版本有更新，请先点右上列表重新加载该文章再合并提交');
      } else {
        showToast(`推送失败：${e.message}`);
      }
    } finally {
      if (pubBtn) { pubBtn.disabled = false; pubBtn.textContent = '发布 ↑'; }
    }
  }

  async function pollBuildProgress(targetUrl = 'https://blog.acretiondisk.top/blog/') {
    const bar = $('#mwDeployBanner');
    if (!bar) return;
    bar.hidden = false;
    bar.textContent = '⏳ GitHub Actions 正在构建部署…';
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 8000));
      const run = await getLatestDeployRun();
      if (!run) continue;
      if (run.status === 'completed') {
        bar.innerHTML = run.conclusion === 'success'
          ? `✅ 博客已构建上线！<a href="${targetUrl}" target="_blank" rel="noopener">查看站点 ↗</a>`
          : `⚠ 构建结束（${run.conclusion}）<a href="${run.url}" target="_blank" rel="noopener">查看日志 ↗</a>`;
        return;
      }
      bar.textContent = `⏳ GitHub Actions ${run.status === 'in_progress' ? '构建中' : '排队中'}…`;
    }
  }

  $('#btnMwPublish')?.addEventListener('click', () => (
    composeMode === 'daily' ? dailyCtrl.publish() : publishToGitHub({ asDraft: false })
  ));
  $('#btnMwSaveDraftRemote')?.addEventListener('click', () => publishToGitHub({ asDraft: true }));

  // ── 9. 设置面板（PAT 直连 vs Cloudflare Worker 双模）──
  function fillSettingsForm() {
    const cfg = loadAuthConfig();
    const set = (id: string, v: string) => { const el = $(id) as HTMLInputElement | null; if (el) el.value = v; };
    document.querySelectorAll('[data-auth-tab]').forEach((b) => {
      (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.authTab === cfg.mode);
    });
    const patBox = $('#mwPatBox');
    const wkBox = $('#mwWorkerBox');
    if (patBox) patBox.hidden = cfg.mode !== 'pat';
    if (wkBox) wkBox.hidden = cfg.mode !== 'worker';
    set('#mwPatInput', cfg.pat || '');
    set('#mwApiBaseInput', cfg.apiBase || 'https://api.github.com');
    set('#mwWorkerUrlInput', cfg.workerUrl || '');
    const st = $('#mwAuthStatus');
    if (st) st.textContent = isConfigured(cfg) ? '✅ 当前已连接，可随时发文与传图' : '未连接：请完成以下任意一种配置';
  }

  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.authTab === 'worker' ? 'worker' : 'pat';
      saveAuthConfig({ mode });
      fillSettingsForm();
    });
  });

  $('#btnMwSavePat')?.addEventListener('click', async () => {
    const pat = (($('#mwPatInput') as HTMLInputElement | null)?.value || '').trim();
    const apiBase = (($('#mwApiBaseInput') as HTMLInputElement | null)?.value || '').trim() || 'https://api.github.com';
    if (!pat) { showToast('请粘贴 GitHub Fine-grained PAT'); return; }
    saveAuthConfig({ mode: 'pat', pat, apiBase });
    try {
      await listBlogFiles();
      fillSettingsForm();
      closeSheets();
      showToast('GitHub PAT 验证成功');
    } catch (err) {
      showToast(`校验失败：${(err as Error).message}`);
    }
  });

  $('#btnMwLoginWorker')?.addEventListener('click', async () => {
    const url = (($('#mwWorkerUrlInput') as HTMLInputElement | null)?.value || '').trim();
    const pwd = (($('#mwWorkerPassInput') as HTMLInputElement | null)?.value || '').trim();
    if (!url || !pwd) { showToast('请填写 Worker 地址和登录密码'); return; }
    try {
      await loginWorker(url, pwd);
      fillSettingsForm();
      closeSheets();
      showToast('Worker 登录成功');
    } catch (err) {
      showToast(`登录失败：${(err as Error).message}`);
    }
  });

  $('#btnMwSettings')?.addEventListener('click', () => { fillSettingsForm(); openSheet('#mwSettingsSheet'); });

  function setComposeMode(nextMode: 'post' | 'daily', { persist = true } = {}) {
    composeMode = nextMode;
    if (persist) {
      try { localStorage.setItem(WRITE_MODE_KEY, nextMode); } catch { /* ignore */ }
    }
    const postMain = $('#mwPostMain');
    const dailyMainEl = $('#mwDailyMain');
    const accBar = $('#mwAccessoryBar');
    if (postMain) postMain.hidden = nextMode === 'daily';
    if (dailyMainEl) dailyMainEl.hidden = nextMode !== 'daily';
    if (accBar) accBar.hidden = nextMode === 'daily';

    document.querySelectorAll('#mwModeTabs [data-mw-mode]').forEach((btn) => {
      const active = (btn as HTMLElement).dataset.mwMode === nextMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const sheetTitle = $('#mwSheetPostsTitle');
    if (sheetTitle) sheetTitle.textContent = nextMode === 'daily' ? '仓库日常（03 日常）' : '仓库文章';
    const searchInput = $('#mwPostsSearch') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.value = '';
      searchInput.placeholder = nextMode === 'daily' ? '搜索日常内容 / 标签 / 地点…' : '搜索文章文件名 / Slug…';
    }

    if (nextMode === 'daily') {
      dailyCtrl.refreshHeader();
    } else {
      const postStatus = currentFilename
        ? (dirty ? '未发布' : '已同步')
        : (dirty ? '已本地暂存' : (isConfigured() ? '新文章' : '待配置'));
      const stats = countMarkdownStats(getBodyMarkdown());
      setHeaderBadges(postStatus, `${stats.chars} 字`);
    }
  }

  document.querySelectorAll('#mwModeTabs [data-mw-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = (btn as HTMLElement).dataset.mwMode === 'daily' ? 'daily' : 'post';
      if (next !== composeMode) setComposeMode(next);
    });
  });

  // 启动恢复 & 若未配置则引导打开设置
  syncMetaSummary();
  restoreDraftIfAny();
  if (!isConfigured()) {
    const st = $('#mwDraftStatus');
    if (st) st.textContent = '待配置';
  }
  const urlMode = new URLSearchParams(window.location.search).get('mode');
  let initialMode: 'post' | 'daily' = 'post';
  if (urlMode === 'daily' || urlMode === 'post') {
    initialMode = urlMode;
  } else {
    try {
      if (localStorage.getItem(WRITE_MODE_KEY) === 'daily') initialMode = 'daily';
    } catch { /* ignore */ }
  }
  setComposeMode(initialMode, { persist: false });
}
