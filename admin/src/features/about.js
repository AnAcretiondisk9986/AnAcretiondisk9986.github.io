/**
 * 关于页面：src/data/about.json 的可视化编辑（头像 / 身份档案 / 段落 / 关联网站 / 项目）。
 * 对齐 HORIZON 主站 about.astro 与首页 03·观测者档案。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const ABOUT_API = '/api/about';
let aboutHash = '';
let aboutBaseline = '';
let aboutDirty = false;
let aboutEditorActive = false;
let ctx = { setupUpload: () => {}, openMediaPicker: null, onDirtyChange: () => {} };

export function initAbout(options = {}) { ctx = { ...ctx, ...options }; }
export function isAboutDirty() { return aboutDirty; }
export function clearAboutDirty() { aboutDirty = false; aboutBaseline = ''; aboutEditorActive = false; ctx.onDirtyChange(false); }

function collectAboutPayload() {
  const collect = (selector, fieldMap) =>
    [...document.querySelectorAll(selector)].map((row) => {
      const out = {};
      fieldMap.forEach(([key, cls]) => { out[key] = row.querySelector('.' + cls)?.value?.trim() || ''; });
      return out;
    }).filter((it) => Object.values(it).some((v) => v !== ''));

  return {
    avatar: $('#fAvatar')?.value?.trim() || '',
    title: $('#fAboutTitle')?.value?.trim() || '',
    subtitle: $('#fSubtitle')?.value?.trim() || '',
    identity: collect('#aboutIdentityRows .about-identity-row', [['label', 'ai-label'], ['value', 'ai-value']]),
    lead: $('#fLead')?.value?.trim() || '',
    paragraphs: ($('#fParagraphs')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
    quoteText: $('#fQuoteText')?.value?.trim() || '',
    interestsTitle: $('#fInterestsTitle')?.value?.trim() || '',
    interests: collect('#aboutInterestsRows .about-interest-row', [['index', 'ai-index'], ['name', 'ai-name'], ['note', 'ai-note']]),
    projectsTitle: $('#fProjectsTitle')?.value?.trim() || '',
    projects: collect('#aboutProjectsRows .about-project-row', [['index', 'ai-index'], ['name', 'ai-name'], ['url', 'ai-url'], ['title', 'ai-title']]),
  };
}

function syncAboutDirty() {
  if (!aboutEditorActive || !$('#fAvatar')) return;
  const next = JSON.stringify(collectAboutPayload()) !== aboutBaseline;
  if (next !== aboutDirty) {
    aboutDirty = next;
    ctx.onDirtyChange(aboutDirty);
  }
}

function markAboutBaseline() {
  aboutEditorActive = true;
  aboutBaseline = JSON.stringify(collectAboutPayload());
  aboutDirty = false;
  ctx.onDirtyChange(false);
}

function renderAboutList() {
  const el = $('#postList');
  el.innerHTML = `
    <div style="padding:12px 14px;font-size:11px;color:var(--text-faint);line-height:1.9">
      <div style="color:var(--accent);margin-bottom:4px">04 · 观测者档案</div>
      <div>编辑「关于」页与首页「03 观测者档案」的头像、身份表、自述、关联网站与项目。</div>
      <div>保存后在顶栏点击「发布」推送上线。</div>
    </div>`;
}

async function loadAbout() {
  try {
    const res = await apiFetch(ABOUT_API);
    const data = await res.json();
    if (data.error) { toast(data.error); return; }
    aboutHash = data.contentHash || '';
    renderAboutEditor(data);
  } catch (e) { toast('加载关于页面失败: ' + e.message); }
}

function refreshAvatarPreview() {
  const src = $('#fAvatar')?.value?.trim() || '';
  const img = $('#avatarPreview');
  if (img) {
    img.src = src || '/logo.webp';
    const hint = $('#avatarHint');
    if (hint) hint.textContent = src ? '圆环轨道头像将同步显示在关于页与首页 03 区块' : '未设置自定义头像，主站将回退显示默认 /logo.webp';
  }
}

function aboutRowTemplate(kind, item) {
  if (kind === 'identity') {
    return `<div class="about-identity-row" style="display:flex;gap:8px;align-items:center">
      <input class="ai-label" placeholder="标签，如：记录名" value="${escAttr(item.label || '')}" style="width:110px" />
      <input class="ai-value" placeholder="内容" value="${escAttr(item.value || '')}" style="flex:1" />
      <button class="btn small danger" type="button" data-about-del>×</button>
    </div>`;
  }
  if (kind === 'interest') {
    return `<div class="about-interest-row" style="display:flex;gap:8px;align-items:center">
      <input class="ai-index" placeholder="01" value="${escAttr(item.index || '')}" style="width:52px" />
      <input class="ai-name" placeholder="站点名（如 GitHub）" value="${escAttr(item.name || '')}" style="width:140px" />
      <input class="ai-note" placeholder="网址 https://… 或说明（自动识别链接）" value="${escAttr(item.note || '')}" style="flex:1" />
      <button class="btn small danger" type="button" data-about-del>×</button>
    </div>`;
  }
  return `<div class="about-project-row" style="display:flex;gap:8px;align-items:center">
    <input class="ai-index" placeholder="1" value="${escAttr(item.index || '')}" style="width:52px" />
    <input class="ai-name" placeholder="项目名称" value="${escAttr(item.name || '')}" style="width:120px" />
    <input class="ai-url" placeholder="网址 https://…" value="${escAttr(item.url || '')}" style="flex:1" />
    <input class="ai-title" placeholder="网页标题（留空则保存时自动解析）" value="${escAttr(item.title || '')}" style="width:200px" />
    <button class="btn small" type="button" data-about-title title="抓取网页 <title> 填入标题框">⤓ 解析</button>
    <button class="btn small danger" type="button" data-about-del>×</button>
  </div>`;
}

function renderAboutEditor(data) {
  data = data || {};
  $('#editorTitle').textContent = '观测者档案（关于页）';
  $('#btnDelete').style.display = 'none';
  $('#btnSave').disabled = false;
  const identity = data.identity || [];
  const interests = data.interests || [];
  const projects = data.projects || [];
  $('#editorContainer').innerHTML = `
    <div class="editor frontend-editor">
      <section class="frontend-section">
        <h3>观测者头像与页面标题</h3>
        <div class="upload-area" id="uploadArea">📎 拖放或点击上传头像图片 → 自动填入地址</div>
        <div class="url-import-bar">
          <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
          <button class="btn small" id="btnImportUrl">导入</button>
          <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
          ${ctx.openMediaPicker ? '<button class="btn small" type="button" id="btnAboutMedia">媒体库</button>' : ''}
        </div>
        <div class="about-orbit-preview">
          <div class="about-orbit-ring">
            <img id="avatarPreview" src="${escAttr(data.avatar || '/logo.webp')}" alt="头像预览" onerror="this.src='/logo.webp'" />
          </div>
          <div class="form-group" style="flex:1">
            <label>头像地址 (avatar)</label>
            <input id="fAvatar" value="${escAttr(data.avatar || '')}" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/avatar.webp" />
            <span class="field-hint" id="avatarHint"></span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1"><label>页面大标题 (title)</label><input id="fAboutTitle" value="${escAttr(data.title || '')}" placeholder="编目者档案" /></div>
          <div class="form-group" style="flex:2"><label>副标题 (subtitle)</label><input id="fSubtitle" value="${escAttr(data.subtitle || '')}" placeholder="关于记录这些文字的人，以及这个网站为何存在。" /></div>
        </div>
      </section>

      <section class="frontend-section">
        <h3>身份档案表（关于页左侧边栏）</h3>
        <div id="aboutIdentityRows" style="display:flex;flex-direction:column;gap:6px">${identity.map((it) => aboutRowTemplate('identity', it)).join('')}</div>
        <button class="btn small" type="button" id="btnAddIdentity" style="align-self:flex-start">＋ 添加一行</button>
      </section>

      <section class="frontend-section">
        <h3>自述正文与首页节选引语</h3>
        <div class="form-group"><label>开头导语 (lead)</label><textarea id="fLead" style="min-height:60px">${esc(data.lead || '')}</textarea></div>
        <div class="form-group">
          <label>正文段落（每行一段）</label>
          <textarea id="fParagraphs" style="min-height:96px">${esc((data.paragraphs || []).join('\n'))}</textarea>
        </div>
        <div class="form-group">
          <label>首页节选引语 (quoteText)</label>
          <input id="fQuoteText" value="${escAttr(data.quoteText || '')}" placeholder="“忠实记录此刻所见，也允许未来的自己重新修订。”" />
          <span class="field-hint">显示在首页「03 · 观测者档案」引文区块。</span>
        </div>
      </section>

      <section class="frontend-section">
        <h3>关联网站（外部通信網）</h3>
        <div class="form-group">
          <label>区块标题 (interestsTitle)</label>
          <input id="fInterestsTitle" value="${escAttr(data.interestsTitle || '')}" placeholder="我的关联网站" />
        </div>
        <div class="form-group">
          <label>外部链接条目（序号 / 名称 / 网址或备注）</label>
          <div id="aboutInterestsRows" style="display:flex;flex-direction:column;gap:6px">${interests.map((it) => aboutRowTemplate('interest', it)).join('')}</div>
          <button class="btn small" type="button" id="btnAddInterest" style="align-self:flex-start;margin-top:6px">＋ 添加一项</button>
        </div>
      </section>

      <section class="frontend-section">
        <h3>我的项目（開発計画）</h3>
        <div class="form-group">
          <label>区块标题 (projectsTitle)</label>
          <input id="fProjectsTitle" value="${escAttr(data.projectsTitle || '')}" placeholder="我的项目" />
        </div>
        <div class="form-group">
          <label>项目条目（序号 / 名称 / 网址 / 网页标题）</label>
          <div id="aboutProjectsRows" style="display:flex;flex-direction:column;gap:6px">${projects.map((it) => aboutRowTemplate('project', it)).join('')}</div>
          <button class="btn small" type="button" id="btnAddProject" style="align-self:flex-start;margin-top:6px">＋ 添加一项</button>
          <span class="field-hint">标题留空时保存会自动抓取网页 &lt;title&gt;；也可点行内「⤓ 解析」即时抓取后手动调整。</span>
        </div>
      </section>
    </div>`;

  ctx.setupUpload();
  $('#btnAboutMedia')?.addEventListener('click', () => {
    ctx.openMediaPicker({
      type: 'image',
      title: '从媒体库选择头像',
      onPick: (m) => {
        const input = $('#fAvatar');
        if (input) {
          input.value = m.url;
          refreshAvatarPreview();
          syncAboutDirty();
        }
        ctx.closeMediaPicker?.();
      },
    });
  });
  $('#fAvatar')?.addEventListener('input', refreshAvatarPreview);
  const root = $('#editorContainer');
  if (root) {
    root.addEventListener('input', (e) => {
      if (e.target?.id === 'fImportUrl' || e.target?.id === 'fImportReferer') return;
      syncAboutDirty();
    });
    root.addEventListener('change', (e) => {
      if (e.target?.id === 'fImportUrl' || e.target?.id === 'fImportReferer') return;
      syncAboutDirty();
    });
  }
  $('#btnAddIdentity').onclick = () => {
    const rows = $('#aboutIdentityRows');
    const div = document.createElement('div');
    div.innerHTML = aboutRowTemplate('identity', {});
    rows.appendChild(div.firstElementChild);
    syncAboutDirty();
  };
  $('#btnAddInterest').onclick = () => {
    const rows = $('#aboutInterestsRows');
    const div = document.createElement('div');
    div.innerHTML = aboutRowTemplate('interest', {});
    rows.appendChild(div.firstElementChild);
    syncAboutDirty();
  };
  $('#btnAddProject').onclick = () => {
    const rows = $('#aboutProjectsRows');
    const div = document.createElement('div');
    div.innerHTML = aboutRowTemplate('project', {});
    rows.appendChild(div.firstElementChild);
    syncAboutDirty();
  };
  document.querySelectorAll('#aboutIdentityRows, #aboutInterestsRows, #aboutProjectsRows').forEach((container) => {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-about-del]');
      if (btn) {
        btn.closest('div.about-identity-row, div.about-interest-row, div.about-project-row')?.remove();
        syncAboutDirty();
      }
      const titleBtn = e.target.closest('[data-about-title]');
      if (titleBtn) {
        const row = titleBtn.closest('div.about-project-row');
        const urlInput = row.querySelector('.ai-url');
        const titleInput = row.querySelector('.ai-title');
        const url = (urlInput.value || '').trim();
        if (!url) { toast('请先填写网址再解析'); return; }
        titleBtn.disabled = true;
        titleBtn.textContent = '解析中…';
        apiFetch(ABOUT_API + '/resolve-title', {
          method: 'POST',
          body: JSON.stringify({ url }),
          headers: { 'Content-Type': 'application/json' },
        })
          .then((res) => res.json())
          .then((resData) => {
            if (resData.error) { toast(resData.error); return; }
            titleInput.value = resData.title || '';
            syncAboutDirty();
            toast(resData.title ? '已解析：' + resData.title : '未能解析到标题（可能被反爬或非 HTML）');
          })
          .catch((err) => toast('解析失败: ' + err.message))
          .finally(() => { titleBtn.disabled = false; titleBtn.textContent = '⤓ 解析'; });
      }
    });
  });
  refreshAvatarPreview();
  markAboutBaseline();
}

async function saveAbout() {
  const payload = collectAboutPayload();
  try {
    const fd = new URLSearchParams();
    fd.set('avatar', payload.avatar);
    fd.set('title', payload.title);
    fd.set('subtitle', payload.subtitle);
    fd.set('lead', payload.lead);
    fd.set('paragraphs', JSON.stringify(payload.paragraphs));
    fd.set('quoteText', payload.quoteText);
    fd.set('interestsTitle', payload.interestsTitle);
    fd.set('identity', JSON.stringify(payload.identity));
    fd.set('interests', JSON.stringify(payload.interests));
    fd.set('projectsTitle', payload.projectsTitle);
    fd.set('projects', JSON.stringify(payload.projects));
    fd.set('expectedHash', aboutHash);
    const res = await apiFetch(ABOUT_API, { method: 'PUT', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await res.json();
    if (data.error) { toast(data.error); return; }
    clearAboutDirty();
    toast('观测者档案已保存');
    await loadAbout();
  } catch (e) { toast('保存失败: ' + e.message); }
}

export { renderAboutList, loadAbout, saveAbout, refreshAvatarPreview, syncAboutDirty };
