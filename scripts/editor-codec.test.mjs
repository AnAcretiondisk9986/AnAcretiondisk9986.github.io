import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownToEditorHtml,
  normalizeLegacyMarkdown,
  serializeDocToMarkdown,
  countMarkdownStats,
  extractOutlineFromDoc,
} from '../src/lib/editor-codec.mjs';

test('normalizeLegacyMarkdown normalizes legacy heading and span+div alignments', () => {
  const input = [
    '# <div style="text-align: center"><span style="color: #b99c60">标题测试</span></div>',
    '<span style="color: #8a8a90"><div style="text-align: center">居中灰字</div></span>',
    '~~<div style="text-align: center">删除居中</div>~~',
    '<div style="text-align:center">纯居中</div>',
  ].join('\n\n');

  const html = markdownToEditorHtml(input);
  assert.match(html, /<h1 style="text-align: center"><span style="color: #b99c60">标题测试<\/span><\/h1>/);
  assert.match(html, /<p style="text-align: center"><span style="color: #8a8a90">居中灰字<\/span><\/p>/);
  assert.match(html, /<p style="text-align: center"><s>删除居中<\/s><\/p>/);
  assert.match(html, /<p style="text-align: center">纯居中<\/p>/);
});

test('markdownToEditorHtml converts math without corrupting underscores in code', () => {
  const input = [
    '行内公式 $a_1 + b_2 = c_3$ 与价格 $100 和 $200。',
    '',
    '$$',
    '\\sum_{i=1}^{n} x_i^2',
    '$$',
    '',
    '```js',
    'const x = "$not_math$";',
    '```',
  ].join('\n');

  const html = markdownToEditorHtml(input);
  assert.match(html, /class="hz-math" data-tex="a_1 \+ b_2 = c_3"/);
  assert.match(html, /\$100 和 \$200/);
  assert.match(html, /class="hz-math-block" data-tex="\\sum_\{i=1\}\^\{n\} x_i\^2"/);
  assert.match(html, /\$not_math\$/);
  assert.doesNotMatch(html, /data-tex="not_math"/);
});

test('markdownToEditorHtml prepares task lists, callouts, and details for Tiptap', () => {
  const input = [
    '- [x] 已完成',
    '- [ ] 未完成',
    '',
    '<div class="hz-callout" data-callout="tip" data-title="提示">',
    '',
    '支持 **加粗**。',
    '',
    '</div>',
    '',
    '<details>',
    '<summary>点击展开</summary>',
    '',
    '折叠内容',
    '',
    '</details>',
  ].join('\n');

  const html = markdownToEditorHtml(input);
  assert.match(html, /<ul data-type="taskList">/);
  assert.match(html, /data-type="taskItem" data-checked="true"/);
  assert.match(html, /data-type="taskItem" data-checked="false"/);
  assert.match(html, /<div class="hz-callout__body"><p>支持 <strong>加粗<\/strong>。/);
  assert.match(html, /<div data-type="detailsContent"><p>折叠内容<\/p><\/div>/);
});

test('serializeDocToMarkdown emits clean Markdown for plain nodes and safe HTML for rich formatting', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'left' }, content: [{ type: 'text', text: '小标题' }] },
      {
        type: 'paragraph',
        attrs: { textAlign: 'center', textIndent: false, lineHeight: null },
        content: [
          { type: 'text', text: '居中加粗', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff5a1a' } }] },
        ],
      },
      {
        type: 'paragraph',
        attrs: { textAlign: 'left', textIndent: true, lineHeight: '1.9' },
        content: [{ type: 'text', text: '首行缩进正文' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '普通' },
          { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
          { type: 'text', text: '高亮', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
          { type: 'mathInline', attrs: { tex: 'E=mc^2' } },
        ],
      },
      { type: 'figureImage', attrs: { src: 'https://cdn.example.com/a.webp', alt: '图A', width: '60%', align: 'center', caption: '图注' } },
      { type: 'imageGallery', attrs: { cols: 2, images: [{ src: 'https://cdn.example.com/1.webp', alt: '1' }, { src: 'https://cdn.example.com/2.webp', alt: '2' }] } },
      { type: 'videoEmbed', attrs: { kind: 'video', src: 'https://cdn.example.com/v.mp4' } },
      { type: 'songPlayer', attrs: { src: 'https://cdn.example.com/a.mp3', title: '测试歌', artist: '歌手' } },
      { type: 'callout', attrs: { kind: 'warn', title: '注意' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '不可忽略' }] }] },
    ],
  };

  const md = serializeDocToMarkdown(doc);
  assert.ok(md.includes('## 小标题'));
  assert.ok(md.includes('<p style="text-align: center"><strong><span style="color: #ff5a1a">居中加粗</span></strong></p>'));
  assert.ok(md.includes('<p style="text-indent: 2em; line-height: 1.9">首行缩进正文</p>'));
  assert.ok(md.includes('<u>下划线</u><mark style="background-color: #fef08a">高亮</mark><span class="hz-math" data-tex="E=mc^2"></span>'));
  assert.ok(md.includes('<figure class="hz-figure" data-align="center" style="width: 60%"><img src="https://cdn.example.com/a.webp" alt="图A" /><figcaption>图注</figcaption></figure>'));
  assert.ok(md.includes('<div class="hz-gallery" data-cols="2">'));
  assert.ok(md.includes('<video controls preload="metadata" src="https://cdn.example.com/v.mp4"></video>'));
  assert.ok(md.includes('data-title="测试歌"'));
  assert.ok(md.includes('<div class="hz-callout" data-callout="warn" data-title="注意">\n\n不可忽略\n\n</div>'));

  const outline = extractOutlineFromDoc(doc);
  assert.deepEqual(outline, [{ index: 0, level: 2, text: '小标题' }]);
});

test('countMarkdownStats counts CJK, Latin words, images, and missing alt', () => {
  const stats = countMarkdownStats('你好 world\n\n![](https://x.com/a.webp)\n\n<img src="https://x.com/b.webp" alt="ok" />');
  assert.ok(stats.chars >= 3);
  assert.equal(stats.images, 2);
  assert.equal(stats.missingAlt, 1);
});
