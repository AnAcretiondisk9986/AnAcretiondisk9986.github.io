/**
 * 关于页面：src/data/about.json 的可视化编辑（头像 / 身份档案 / 段落 / 兴趣 / 项目）。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const ABOUT_API = '/api/about';
let aboutHash = '';
let ctx = { setupUpload: () => {} };

export function initAbout(options = {}) { ctx = { ...ctx, ...options }; }

    function renderAboutList() {
      const el = $('#postList');
      el.innerHTML = `
        <div style="padding:12px 14px;font-size:11px;color:#6a6a70;line-height:1.9">
          <div style="color:#c8b080;margin-bottom:4px">📄 关于页面</div>
          <div>右侧编辑「关于」页的全部文本与头像，</div>
          <div>保存后需点击「⬆ 推送」发布到网站。</div>
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
        img.src = src || '/favicon.svg';
        img.style.display = src ? 'block' : 'none';
        const hint = $('#avatarHint');
        if (hint) hint.textContent = src ? '' : '尚未设置头像，网站将显示书本标记';
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
          <input class="ai-index" placeholder="序号" value="${escAttr(item.index || '')}" style="width:50px" />
          <input class="ai-name" placeholder="名称" value="${escAttr(item.name || '')}" style="width:130px" />
          <input class="ai-note" placeholder="链接/备注（粘贴 http(s) 链接自动可跳转）" value="${escAttr(item.note || '')}" style="flex:1" />
          <button class="btn small danger" type="button" data-about-del>×</button>
        </div>`;
      }
      return `<div class="about-project-row" style="display:flex;gap:8px;align-items:center">
        <input class="ai-index" placeholder="序号" value="${escAttr(item.index || '')}" style="width:50px" />
        <input class="ai-name" placeholder="名称" value="${escAttr(item.name || '')}" style="width:110px" />
        <input class="ai-url" placeholder="网址 https://…" value="${escAttr(item.url || '')}" style="flex:1" />
        <input class="ai-title" placeholder="网页标题（留空则保存时自动解析）" value="${escAttr(item.title || '')}" style="width:200px" />
        <button class="btn small" type="button" data-about-title title="抓取网页 <title> 填入标题框">⤓ 解析</button>
        <button class="btn small danger" type="button" data-about-del>×</button>
      </div>`;
    }

    function renderAboutEditor(data) {
      data = data || {};
      $('#editorTitle').textContent = '关于页面';
      $('#btnDelete').style.display = 'none';
      $('#btnSave').disabled = false;
      const identity = data.identity || [];
      const interests = data.interests || [];
      const projects = data.projects || [];
      $('#editorContainer').innerHTML = `
        <div class="editor">
          <div class="form-group">
            <label>头像（原先的书本标记区域）</label>
            <div class="upload-area" id="uploadArea">📎 拖放或点击上传头像图片 → 自动填入地址</div>
            <div class="url-import-bar">
              <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
              <button class="btn small" id="btnImportUrl">导入</button>
              <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
            </div>
            <div class="form-row" style="margin-top:6px">
              <div class="form-group" style="flex:1"><label>头像地址 (src)</label><input id="fAvatar" value="${escAttr(data.avatar || '')}" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/avatar.webp" /></div>
              <div class="form-group" style="flex:1"><label>预览</label>
                <div style="display:flex;gap:10px;align-items:center;min-height:52px">
                  <img id="avatarPreview" src="${escAttr(data.avatar || '')}" alt="头像预览" style="width:52px;height:52px;object-fit:cover;border:1px solid #2a2a30;border-radius:2px;display:${data.avatar ? 'block' : 'none'}" onerror="this.style.display='none'" />
                  <small id="avatarHint" style="color:#5a5a50;font-size:10px">${data.avatar ? '' : '尚未设置头像，网站将显示书本标记'}</small>
                </div>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1"><label>眉题 (eyebrow)</label><input id="fEyebrow" value="${escAttr(data.eyebrow || '')}" placeholder="DOSSIER OF THE KEEPER" /></div>
            <div class="form-group" style="flex:1"><label>大标题</label><input id="fAboutTitle" value="${escAttr(data.title || '')}" placeholder="编目者档案" /></div>
          </div>
          <div class="form-group"><label>副标题</label><input id="fSubtitle" value="${escAttr(data.subtitle || '')}" placeholder="关于记录这些文字的人，以及这个网站为何存在。" /></div>

          <div class="form-group">
            <label>身份档案表（左侧列表）</label>
            <div id="aboutIdentityRows" style="display:flex;flex-direction:column;gap:6px">${identity.map(it => aboutRowTemplate('identity', it)).join('')}</div>
            <button class="btn small" type="button" id="btnAddIdentity" style="align-self:flex-start;margin-top:6px">＋ 添加一行</button>
          </div>

          <div class="form-group"><label>开头段 (lead)</label><textarea id="fLead" style="min-height:64px">${esc(data.lead || '')}</textarea></div>
          <div class="form-group">
            <label>正文段落（每行一段）</label>
            <textarea id="fParagraphs" style="min-height:96px">${esc((data.paragraphs || []).join('\n'))}</textarea>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1"><label>引用标签</label><input id="fQuoteLabel" value="${escAttr(data.quoteLabel || '')}" placeholder="编目原则" /></div>
            <div class="form-group" style="flex:2"><label>引用内容</label><input id="fQuoteText" value="${escAttr(data.quoteText || '')}" placeholder="“……”" /></div>
          </div>

          <div class="form-group">
            <label>研究兴趣列表标题</label><input id="fInterestsTitle" value="${escAttr(data.interestsTitle || '')}" placeholder="研究与兴趣索引" />
          </div>
          <div class="form-group">
            <label>兴趣条目（序号 / 名称 / 备注）</label>
            <div id="aboutInterestsRows" style="display:flex;flex-direction:column;gap:6px">${interests.map(it => aboutRowTemplate('interest', it)).join('')}</div>
            <button class="btn small" type="button" id="btnAddInterest" style="align-self:flex-start;margin-top:6px">＋ 添加一项</button>
          </div>

          <div class="form-group">
            <label>项目列表标题</label><input id="fProjectsTitle" value="${escAttr(data.projectsTitle || '')}" placeholder="我的项目" />
          </div>
          <div class="form-group">
            <label>项目条目（序号 / 名称 / 网址 / 网页标题）</label>
            <div id="aboutProjectsRows" style="display:flex;flex-direction:column;gap:6px">${projects.map(it => aboutRowTemplate('project', it)).join('')}</div>
            <button class="btn small" type="button" id="btnAddProject" style="align-self:flex-start;margin-top:6px">＋ 添加一项</button>
            <small style="display:block;color:#5a5a50;font-size:10px;margin-top:4px">网址解析：标题留空时保存会自动抓取网页 &lt;title&gt;；也可点行内「⤓ 解析」即时抓取后手动修改。</small>
          </div>
        </div>`;

      ctx.setupUpload();
      $('#fAvatar')?.addEventListener('input', refreshAvatarPreview);
      $('#btnAddIdentity').onclick = () => {
        const rows = $('#aboutIdentityRows');
        const div = document.createElement('div');
        div.innerHTML = aboutRowTemplate('identity', {});
        rows.appendChild(div.firstElementChild);
      };
      $('#btnAddInterest').onclick = () => {
        const rows = $('#aboutInterestsRows');
        const div = document.createElement('div');
        div.innerHTML = aboutRowTemplate('interest', {});
        rows.appendChild(div.firstElementChild);
      };
      $('#btnAddProject').onclick = () => {
        const rows = $('#aboutProjectsRows');
        const div = document.createElement('div');
        div.innerHTML = aboutRowTemplate('project', {});
        rows.appendChild(div.firstElementChild);
      };
      // 删除行 / 解析标题（事件委托）
      document.querySelectorAll('#aboutIdentityRows, #aboutInterestsRows, #aboutProjectsRows').forEach(container => {
        container.addEventListener('click', e => {
          const btn = e.target.closest('[data-about-del]');
          if (btn) btn.closest('div.about-identity-row, div.about-interest-row, div.about-project-row')?.remove();
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
              .then(res => res.json())
              .then(data => {
                if (data.error) { toast(data.error); return; }
                titleInput.value = data.title || '';
                toast(data.title ? '已解析：' + data.title : '未能解析到标题（可能被反爬或非 HTML）');
              })
              .catch(err => toast('解析失败: ' + err.message))
              .finally(() => { titleBtn.disabled = false; titleBtn.textContent = '⤓ 解析'; });
          }
        });
      });
      refreshAvatarPreview();
    }

    async function saveAbout() {
      // fieldMap: [提交键名, 行内输入框类名]
      const collect = (selector, fieldMap) =>
        [...document.querySelectorAll(selector)].map(row => {
          const out = {};
          fieldMap.forEach(([key, cls]) => { out[key] = row.querySelector('.' + cls)?.value?.trim() || ''; });
          return out;
        }).filter(it => Object.values(it).some(v => v !== ''));

      const payload = {
        avatar: $('#fAvatar')?.value?.trim() || '',
        eyebrow: $('#fEyebrow')?.value?.trim() || '',
        title: $('#fAboutTitle')?.value?.trim() || '',
        subtitle: $('#fSubtitle')?.value?.trim() || '',
        identity: collect('#aboutIdentityRows .about-identity-row', [['label', 'ai-label'], ['value', 'ai-value']]),
        lead: $('#fLead')?.value?.trim() || '',
        paragraphs: ($('#fParagraphs')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
        quoteLabel: $('#fQuoteLabel')?.value?.trim() || '',
        quoteText: $('#fQuoteText')?.value?.trim() || '',
        interestsTitle: $('#fInterestsTitle')?.value?.trim() || '',
        interests: collect('#aboutInterestsRows .about-interest-row', [['index', 'ai-index'], ['name', 'ai-name'], ['note', 'ai-note']]),
        projectsTitle: $('#fProjectsTitle')?.value?.trim() || '',
        projects: collect('#aboutProjectsRows .about-project-row', [['index', 'ai-index'], ['name', 'ai-name'], ['url', 'ai-url'], ['title', 'ai-title']]),
      };

      try {
        const fd = new URLSearchParams();
        fd.set('avatar', payload.avatar);
        fd.set('eyebrow', payload.eyebrow);
        fd.set('title', payload.title);
        fd.set('subtitle', payload.subtitle);
        fd.set('lead', payload.lead);
        fd.set('paragraphs', JSON.stringify(payload.paragraphs));
        fd.set('quoteLabel', payload.quoteLabel);
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
        toast('关于页面已保存');
        await loadAbout();
      } catch (e) { toast('保存失败: ' + e.message); }
    }

    // ═══════════════════════════════════════
    // 留言管理（Waline）
    // ═══════════════════════════════════════


export { renderAboutList, loadAbout, saveAbout, refreshAvatarPreview };
