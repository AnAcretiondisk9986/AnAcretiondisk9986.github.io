/**
 * Tiptap 自定义节点与 Word 级属性扩展：
 * - Paragraph / Heading 扩展对齐、首行缩进、行距
 * - FigureImage（可拖拽缩放、对齐、图注、浮动操作条）
 * - ImageGallery（2/3 列多图并排网格）
 * - VideoEmbed（B站 / YouTube / iframe / 本地视频 <video>）
 * - SongPlayer（音频卡片实时试听）
 * - Callout（笔记 / 提示 / 注意 / 警告 / 摘录块）
 * - AttachmentCard / BookmarkCard / MathInline / MathBlock
 */
import { Node, mergeAttributes } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import katex from 'katex';

export const ExtendedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textIndent: {
        default: false,
        parseHTML: (el) => {
          const indent = el.style?.textIndent || '';
          return indent === '2em' || parseFloat(indent) > 0;
        },
        renderHTML: (attrs) => (attrs.textIndent ? { style: 'text-indent: 2em' } : {}),
      },
      lineHeight: {
        default: null,
        parseHTML: (el) => el.style?.lineHeight || null,
        renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
      },
    };
  },
});

export const ExtendedHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
    };
  },
});

function createEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function attachCdnRetry(img) {
  img.addEventListener('error', () => {
    if (!img.src || img.dataset.retryDone) return;
    const n = parseInt(img.dataset.retryCount || '0', 10);
    if (n >= 5) { img.dataset.retryDone = '1'; return; }
    img.dataset.retryCount = String(n + 1);
    const orig = img.dataset.origSrc || img.src;
    img.dataset.origSrc = orig;
    setTimeout(() => {
      if (!img.isConnected) return;
      const mirrors = [null, null, 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'];
      const host = mirrors[Math.min(n, mirrors.length - 1)];
      img.src = host && orig.includes('cdn.jsdelivr.net') ? orig.replace('cdn.jsdelivr.net', host) : orig;
    }, 1200 * (n + 1));
  });
}

export const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  draggable: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      onAction: null,
    };
  },

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: '' },
      width: { default: '' },
      align: { default: 'center' },
      caption: { default: '' },
      rounded: { default: true },
      originalSrc: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure.hz-figure',
        getAttrs: (el) => {
          const img = el.querySelector('img');
          if (!img) return false;
          const cap = el.querySelector('figcaption');
          return {
            src: img.getAttribute('src') || '',
            alt: img.getAttribute('alt') || '',
            title: img.getAttribute('title') || '',
            width: el.style?.width || img.style?.width || '',
            align: el.getAttribute('data-align') || 'center',
            caption: cap ? cap.textContent || '' : '',
            rounded: img.style?.borderRadius !== '0px' && img.style?.borderRadius !== '0',
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          if (el.closest('figure.hz-figure') || el.closest('.hz-gallery')) return false;
          return {
            src: el.getAttribute('src') || '',
            alt: el.getAttribute('alt') || '',
            title: el.getAttribute('title') || '',
            width: el.style?.width || el.getAttribute('width') || '',
            align: el.getAttribute('data-align') || 'none',
            caption: '',
            rounded: el.style?.borderRadius !== '0px' && el.style?.borderRadius !== '0',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, title, width, align, caption, rounded } = HTMLAttributes;
    const style = [width ? `width: ${width}` : '', rounded === false ? 'border-radius: 0' : ''].filter(Boolean).join('; ');
    if (caption) {
      return [
        'figure',
        { class: 'hz-figure', 'data-align': align || 'center', ...(width ? { style: `width: ${width}` } : {}) },
        ['img', { src, alt, ...(title ? { title } : {}) }],
        ['figcaption', {}, caption],
      ];
    }
    return ['img', mergeAttributes({ src, alt }, title ? { title } : {}, style ? { style } : {}, align && align !== 'none' ? { 'data-align': align } : {})];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrap = createEl('figure', 'acr-img-node');
      const box = createEl('div', 'acr-img-box');
      const img = document.createElement('img');
      attachCdnRetry(img);
      const handle = createEl('span', 'acr-img-resize-handle');
      handle.title = '拖动缩放图片宽度';

      const bar = createEl('div', 'acr-node-bar acr-img-bar');
      const mkBtn = (label, title, fn) => {
        const b = createEl('button', 'acr-nb-btn', label);
        b.type = 'button';
        b.title = title;
        b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
        return b;
      };
      const updateAttrs = (patch) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
      };

      ['25%', '50%', '75%', '100%'].forEach((w) => bar.appendChild(mkBtn(w, `宽度 ${w}`, () => updateAttrs({ width: w }))));
      bar.appendChild(mkBtn('原图', '取消固定宽度', () => updateAttrs({ width: '' })));
      bar.appendChild(createEl('span', 'acr-nb-sep'));
      bar.appendChild(mkBtn('左', '左对齐', () => updateAttrs({ align: 'left' })));
      bar.appendChild(mkBtn('中', '居中', () => updateAttrs({ align: 'center' })));
      bar.appendChild(mkBtn('右', '右对齐', () => updateAttrs({ align: 'right' })));
      bar.appendChild(createEl('span', 'acr-nb-sep'));
      bar.appendChild(mkBtn('图注', '添加或编辑图片说明', () => {
        const cur = (typeof getPos === 'function' ? editor.state.doc.nodeAt(getPos()) : node)?.attrs || node.attrs;
        const next = window.prompt('输入图片说明（留空则隐藏图注）：', cur.caption || '');
        if (next !== null) updateAttrs({ caption: next.trim() });
      }));
      bar.appendChild(mkBtn('Alt', '修改替代文本 (alt)', () => {
        const cur = (typeof getPos === 'function' ? editor.state.doc.nodeAt(getPos()) : node)?.attrs || node.attrs;
        const next = window.prompt('输入图片 Alt 说明（利于无障碍与 SEO）：', cur.alt || '');
        if (next !== null) updateAttrs({ alt: next.trim() });
      }));
      bar.appendChild(mkBtn('替换', '从媒体库替换图片', () => {
        this.options.onAction?.('replace-image', { getPos, node, updateAttrs });
      }));
      bar.appendChild(mkBtn('删', '删除图片', () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      }));

      const capEl = createEl('figcaption', 'acr-img-caption');
      capEl.contentEditable = 'false';

      // 右下角拖拽缩放宽度（按百分比）
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = box.getBoundingClientRect().width;
        const parentW = Math.max(200, wrap.parentElement?.getBoundingClientRect().width || wrap.getBoundingClientRect().width || 680);
        const onMove = (ev) => {
          const nextPx = Math.max(80, Math.min(parentW, startW + (ev.clientX - startX)));
          const pct = Math.max(15, Math.min(100, Math.round((nextPx / parentW) * 100)));
          box.style.width = `${pct}%`;
        };
        const onUp = (ev) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const nextPx = Math.max(80, Math.min(parentW, startW + (ev.clientX - startX)));
          const pct = Math.max(15, Math.min(100, Math.round((nextPx / parentW) * 100)));
          updateAttrs({ width: `${pct}%` });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      box.append(img, handle, bar);
      wrap.append(box, capEl);

      const sync = (n) => {
        const a = n.attrs || {};
        if (img.src !== a.src) {
          delete img.dataset.retryDone;
          delete img.dataset.retryCount;
          img.dataset.origSrc = a.src || '';
          img.src = a.src || '';
        }
        img.alt = a.alt || '';
        img.title = a.title || '';
        img.style.borderRadius = a.rounded === false ? '0' : '';
        box.style.width = a.width || '';
        wrap.dataset.align = a.align || 'center';
        capEl.textContent = a.caption || '';
        capEl.hidden = !a.caption;
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
        selectNode: () => wrap.classList.add('ProseMirror-selectednode'),
        deselectNode: () => wrap.classList.remove('ProseMirror-selectednode'),
      };
    };
  },
});

export const ImageGallery = Node.create({
  name: 'imageGallery',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { onAction: null };
  },

  addAttributes() {
    return {
      cols: { default: 2 },
      images: { default: [] },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.hz-gallery',
      getAttrs: (el) => {
        const cols = Number(el.getAttribute('data-cols')) === 3 ? 3 : 2;
        const images = [...el.querySelectorAll('img')].map((img) => ({
          src: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || '图片',
        })).filter((it) => it.src);
        return { cols, images };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const cols = Number(HTMLAttributes.cols) === 3 ? 3 : 2;
    const imgs = (HTMLAttributes.images || []).map((it) => ['img', { src: it.src, alt: it.alt || '图片' }]);
    return ['div', { class: 'hz-gallery', 'data-cols': String(cols) }, ...imgs];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'acr-gallery-node');
      const head = createEl('div', 'acr-gallery-head');
      const title = createEl('span', 'acr-gallery-label');
      const actions = createEl('div', 'acr-gallery-actions');
      const grid = createEl('div', 'acr-gallery-grid');

      const updateAttrs = (patch) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
      };

      const mkBtn = (label, fn) => {
        const b = createEl('button', 'acr-nb-btn', label);
        b.type = 'button';
        b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
        return b;
      };

      actions.append(
        mkBtn('2 列', () => updateAttrs({ cols: 2 })),
        mkBtn('3 列', () => updateAttrs({ cols: 3 })),
        mkBtn('+ 加图', () => {
          const cur = (typeof getPos === 'function' ? editor.state.doc.nodeAt(getPos()) : node)?.attrs || node.attrs;
          this.options.onAction?.('gallery-add', { currentImages: cur.images || [], updateAttrs });
        }),
        mkBtn('删拼图', () => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos === null || pos === undefined) return;
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        }),
      );
      head.append(title, actions);
      dom.append(head, grid);

      const sync = (n) => {
        const cols = Number(n.attrs?.cols) === 3 ? 3 : 2;
        const imgs = Array.isArray(n.attrs?.images) ? n.attrs.images : [];
        title.textContent = `多图网格 · ${cols} 列 · ${imgs.length} 张`;
        grid.dataset.cols = String(cols);
        grid.innerHTML = '';
        imgs.forEach((it, idx) => {
          const cell = createEl('div', 'acr-gallery-cell');
          const img = document.createElement('img');
          attachCdnRetry(img);
          img.src = it.src;
          img.alt = it.alt || '图片';
          const rm = createEl('button', 'acr-gallery-rm', '×');
          rm.type = 'button';
          rm.title = '移除这张';
          rm.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
          rm.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const next = imgs.filter((_, i) => i !== idx);
            if (!next.length) {
              const pos = typeof getPos === 'function' ? getPos() : null;
              if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + n.nodeSize }).run();
            } else {
              updateAttrs({ images: next });
            }
          };
          cell.append(img, rm);
          grid.append(cell);
        });
      };
      sync(node);

      return {
        dom,
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

export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'iframe' },
      src: { default: '' },
      title: { default: '嵌入式视频播放器' },
      poster: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.video-embed',
        getAttrs: (el) => {
          const video = el.querySelector('video');
          if (video) {
            return {
              kind: 'video',
              src: video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || '',
              title: video.getAttribute('title') || '视频播放',
              poster: video.getAttribute('poster') || '',
            };
          }
          const iframe = el.querySelector('iframe');
          if (iframe) {
            return {
              kind: 'iframe',
              src: iframe.getAttribute('src') || '',
              title: iframe.getAttribute('title') || '嵌入式视频播放器',
              poster: '',
            };
          }
          return false;
        },
      },
      {
        tag: 'iframe[src]',
        getAttrs: (el) => {
          if (el.closest('div.video-embed')) return false;
          const src = el.getAttribute('src') || '';
          if (!src) return false;
          return {
            kind: 'iframe',
            src,
            title: el.getAttribute('title') || '嵌入式视频播放器',
            poster: '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    if (HTMLAttributes.kind === 'video') {
      return ['div', { class: 'video-embed' }, ['video', { controls: 'controls', preload: 'metadata', src: HTMLAttributes.src, ...(HTMLAttributes.poster ? { poster: HTMLAttributes.poster } : {}) }]];
    }
    return ['div', { class: 'video-embed' }, ['iframe', { src: HTMLAttributes.src, title: HTMLAttributes.title || '嵌入式视频播放器', loading: 'lazy', allowfullscreen: 'true' }]];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'acr-media-card video-embed');
      const head = createEl('div', 'acr-media-card-head');
      const label = createEl('span', '', '▶ 视频嵌入');
      const del = createEl('button', 'acr-nb-btn', '删除');
      del.type = 'button';
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      head.append(label, del);
      const body = createEl('div', 'acr-media-card-body');
      dom.append(head, body);

      const sync = (n) => {
        const a = n.attrs || {};
        label.textContent = a.kind === 'video' ? `▶ 本地/直链视频` : `▶ 流媒体视频 (${(a.src || '').slice(0, 48)})`;
        body.innerHTML = '';
        if (a.kind === 'video') {
          const v = document.createElement('video');
          v.controls = true;
          v.preload = 'metadata';
          v.src = a.src || '';
          if (a.poster) v.poster = a.poster;
          body.appendChild(v);
        } else {
          const f = document.createElement('iframe');
          f.src = a.src || '';
          f.title = a.title || '嵌入式视频播放器';
          f.allowFullscreen = true;
          body.appendChild(f);
        }
      };
      sync(node);

      return {
        dom,
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

export const SongPlayer = Node.create({
  name: 'songPlayer',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      title: { default: '' },
      artist: { default: '' },
      cover: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.song-player',
      getAttrs: (el) => ({
        src: el.getAttribute('data-src') || el.querySelector('a')?.getAttribute('href') || '',
        title: el.getAttribute('data-title') || '',
        artist: el.getAttribute('data-artist') || '',
        cover: el.getAttribute('data-cover') || '',
      }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { class: 'song-player', 'data-src': HTMLAttributes.src || '' };
    if (HTMLAttributes.title) attrs['data-title'] = HTMLAttributes.title;
    if (HTMLAttributes.artist) attrs['data-artist'] = HTMLAttributes.artist;
    if (HTMLAttributes.cover) attrs['data-cover'] = HTMLAttributes.cover;
    return ['div', attrs, ['a', { href: HTMLAttributes.src || '#' }, '♪ 播放音频']];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'acr-media-card acr-song-card');
      const head = createEl('div', 'acr-media-card-head');
      const label = createEl('span', '', '♪ 音乐播放条');
      const del = createEl('button', 'acr-nb-btn', '删除');
      del.type = 'button';
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      head.append(label, del);
      const body = createEl('div', 'acr-song-preview');
      dom.append(head, body);

      const sync = (n) => {
        const a = n.attrs || {};
        body.innerHTML = '';
        if (a.cover) {
          const img = document.createElement('img');
          img.src = a.cover;
          img.className = 'acr-song-cover';
          body.appendChild(img);
        }
        const meta = createEl('div', 'acr-song-meta');
        meta.append(
          createEl('div', 'acr-song-title', a.title || '音频播放条'),
          createEl('div', 'acr-song-artist', a.artist || a.src || ''),
        );
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = a.src || '';
        body.append(meta, audio);
      };
      sync(node);

      return {
        dom,
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

const CALLOUT_LABELS = {
  note: '📝 笔记',
  tip: '💡 提示',
  warn: '⚠ 注意',
  danger: '❗ 警告',
  quote: '❝ 摘录',
};

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      kind: { default: 'note' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.hz-callout',
      contentElement: (el) => el.querySelector('.hz-callout__body') || el,
      getAttrs: (el) => ({
        kind: el.getAttribute('data-callout') || 'note',
        title: el.getAttribute('data-title') || '',
      }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'hz-callout', 'data-callout': HTMLAttributes.kind || 'note', ...(HTMLAttributes.title ? { 'data-title': HTMLAttributes.title } : {}) }, ['div', { class: 'hz-callout__body' }, 0]];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'hz-callout acr-callout-node');
      const head = createEl('div', 'acr-callout-head');
      const select = document.createElement('select');
      select.className = 'acr-callout-kind';
      Object.entries(CALLOUT_LABELS).forEach(([k, label]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = label;
        select.appendChild(opt);
      });
      const titleInput = document.createElement('input');
      titleInput.className = 'acr-callout-title';
      titleInput.placeholder = '可选标题（例如：要点提示）';
      const del = createEl('button', 'acr-nb-btn', '移除框');
      del.type = 'button';

      const updateAttrs = (patch) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
      };

      select.onchange = () => updateAttrs({ kind: select.value });
      titleInput.oninput = () => updateAttrs({ title: titleInput.value });
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };

      head.append(select, titleInput, del);
      const content = createEl('div', 'hz-callout__body');
      dom.append(head, content);

      const sync = (n) => {
        const kind = n.attrs?.kind || 'note';
        dom.dataset.callout = kind;
        select.value = kind;
        if (document.activeElement !== titleInput) titleInput.value = n.attrs?.title || '';
      };
      sync(node);

      return {
        dom,
        contentDOM: content,
        update: (updated) => {
          if (updated.type !== this.type) return false;
          node = updated;
          sync(updated);
          return true;
        },
        stopEvent: (event) => head.contains(event.target),
      };
    };
  },
});

export const AttachmentCard = Node.create({
  name: 'attachmentCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: '' },
      name: { default: '附件' },
      size: { default: '' },
      ext: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.hz-attachment',
      getAttrs: (el) => {
        const a = el.querySelector('a');
        return {
          href: el.getAttribute('data-href') || a?.getAttribute('href') || '',
          name: el.getAttribute('data-name') || a?.textContent?.replace(/^📎\s*/, '').trim() || '附件',
          size: el.getAttribute('data-size') || '',
          ext: el.getAttribute('data-ext') || '',
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        class: 'hz-attachment',
        'data-href': HTMLAttributes.href,
        'data-name': HTMLAttributes.name,
        'data-size': HTMLAttributes.size,
        'data-ext': HTMLAttributes.ext,
      },
      ['a', { href: HTMLAttributes.href || '#', target: '_blank', rel: 'noopener' }, `📎 ${HTMLAttributes.name}`],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'acr-media-card acr-attach-card');
      const info = createEl('div', 'acr-attach-info');
      const actions = createEl('div', 'acr-gallery-actions');
      const open = createEl('a', 'acr-nb-btn', '打开');
      open.target = '_blank';
      open.rel = 'noopener';
      const del = createEl('button', 'acr-nb-btn', '删除');
      del.type = 'button';
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      actions.append(open, del);
      dom.append(info, actions);

      const sync = (n) => {
        const a = n.attrs || {};
        info.textContent = `📎 ${a.name || '附件'}${a.size ? ` · ${a.size}` : ''}${a.ext ? ` (${a.ext.toUpperCase()})` : ''}`;
        open.href = a.href || '#';
      };
      sync(node);

      return {
        dom,
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

export const BookmarkCard = Node.create({
  name: 'bookmarkCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.hz-bookmark',
      getAttrs: (el) => {
        const a = el.querySelector('a');
        return {
          url: a?.getAttribute('href') || '',
          title: el.querySelector('strong')?.textContent || '',
          description: el.querySelector('span')?.textContent || '',
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'hz-bookmark' },
      ['a', { href: HTMLAttributes.url || '#', target: '_blank', rel: 'noopener' }, ['strong', {}, HTMLAttributes.title || HTMLAttributes.url || '链接'], ['span', {}, HTMLAttributes.description || ''], ['small', {}, HTMLAttributes.url || '']],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'acr-media-card acr-bookmark-card');
      const box = createEl('div', 'acr-bookmark-info');
      const del = createEl('button', 'acr-nb-btn', '删除');
      del.type = 'button';
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      dom.append(box, del);

      const sync = (n) => {
        const a = n.attrs || {};
        box.innerHTML = '';
        box.append(
          createEl('strong', '', a.title || a.url || '网页书签'),
          createEl('div', 'acr-bookmark-desc', a.description || ''),
          createEl('small', 'acr-bookmark-url', a.url || ''),
        );
      };
      sync(node);

      return {
        dom,
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

function renderKatexSafe(el, tex, displayMode) {
  try {
    katex.render(String(tex || ''), el, { displayMode, throwOnError: false, strict: false });
  } catch {
    el.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
  }
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { tex: { default: '' } };
  },

  parseHTML() {
    return [{
      tag: 'span.hz-math[data-tex]',
      getAttrs: (el) => ({ tex: el.getAttribute('data-tex') || el.textContent || '' }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'hz-math', 'data-tex': HTMLAttributes.tex || '' }];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('span', 'hz-math acr-math-inline');
      dom.title = '点击编辑 LaTeX 公式';
      dom.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = (typeof getPos === 'function' ? editor.state.doc.nodeAt(getPos()) : node)?.attrs?.tex || '';
        const next = window.prompt('编辑行内 LaTeX 公式：', cur);
        if (next === null) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        if (!next.trim()) {
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        } else {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { tex: next.trim() }));
        }
      };
      renderKatexSafe(dom, node.attrs?.tex, false);
      return {
        dom,
        update: (updated) => {
          if (updated.type !== this.type) return false;
          node = updated;
          renderKatexSafe(dom, updated.attrs?.tex, false);
          return true;
        },
      };
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { tex: { default: '' } };
  },

  parseHTML() {
    return [{
      tag: 'div.hz-math-block[data-tex]',
      getAttrs: (el) => ({ tex: el.getAttribute('data-tex') || el.textContent || '' }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'hz-math-block', 'data-tex': HTMLAttributes.tex || '' }];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = createEl('div', 'hz-math-block acr-math-block');
      dom.title = '点击编辑块级 LaTeX 公式';
      const del = createEl('button', 'acr-nb-btn acr-math-del', '删除');
      del.type = 'button';
      del.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };
      const formula = createEl('div', 'acr-math-render');
      formula.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = (typeof getPos === 'function' ? editor.state.doc.nodeAt(getPos()) : node)?.attrs?.tex || '';
        const next = window.prompt('编辑块级 LaTeX 公式：', cur);
        if (next === null) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        if (!next.trim()) {
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        } else {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { tex: next.trim() }));
        }
      };
      dom.append(formula, del);
      renderKatexSafe(formula, node.attrs?.tex, true);
      return {
        dom,
        update: (updated) => {
          if (updated.type !== this.type) return false;
          node = updated;
          renderKatexSafe(formula, updated.attrs?.tex, true);
          return true;
        },
      };
    };
  },
});
