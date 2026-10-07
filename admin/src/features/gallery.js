/**
 * 画廊：独立收藏图片的增删改（src/data/gallery.json，带版本冲突校验）。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const GALLERY_API = '/api/gallery';
let galleryItems = [];
let currentGalleryId = null;
let galleryHash = '';

let ctx = { setupUpload: () => {}, setupGalleryMediaButton: () => {} };

export function initGallery(options = {}) { ctx = { ...ctx, ...options }; }
export function getCurrentGalleryId() { return currentGalleryId; }
export function resetGallerySelection() { currentGalleryId = null; }
    async function loadGallery() {
      try {
        const res = await apiFetch(GALLERY_API);
        galleryHash = res.headers.get('x-content-hash') || '';
        galleryItems = await res.json();
        renderGalleryList();
      } catch(e) { toast('加载画廊失败: '+e.message) }
    }

    function renderGalleryList() {
      const el = $('#postList');
      if(!galleryItems.length){el.innerHTML='<div class="empty-state" style="padding:30px">暂无独立收藏</div>';return}
      el.innerHTML = galleryItems.map(item=>`
        <div class="gallery-list-item${item.id===currentGalleryId?' active':''}" data-gallery-id="${item.id}">
          <img src="${item.src}" alt="${escAttr(item.alt||item.title)}" loading="lazy" onerror="this.style.display='none'" />
          <div class="info" data-gallery-open="${escAttr(item.id)}">
            <div class="title">${esc(item.title)}</div>
            <div class="meta">${item.date||'无日期'}${item.dayIndex?` · #${item.dayIndex}`:''}</div>
          </div>
          <div class="actions">
            <button class="btn small danger" data-gallery-delete="${escAttr(item.id)}" title="删除">×</button>
          </div>
        </div>`).join('');
      el.onclick = (e) => {
        const del = e.target.closest('[data-gallery-delete]');
        if (del) { e.stopPropagation(); deleteGalleryItem(del.dataset.galleryDelete); return; }
        const open = e.target.closest('[data-gallery-open]');
        if (open) selectGalleryItem(open.dataset.galleryOpen);
      };
    }

    async function selectGalleryItem(id) {
      currentGalleryId = id;
      try {
        const res = await apiFetch(`${GALLERY_API}/${id}`);
        const item = await res.json();
        if(item.error){toast(item.error);return}
        renderGalleryEditor(item); renderGalleryList();
      } catch(e) { toast('加载失败') }
    }

    function renderGalleryEditor(item) {
      $('#editorTitle').textContent = item.title ? '编辑：' + item.title : '编辑独立收藏';
      $('#btnDelete').style.display = '';
      $('#btnSave').disabled = false;
      $('#editorContainer').innerHTML = `
        <div class="editor">
          <div class="upload-area" id="uploadArea">📎 拖放或点击上传图片 → 自动填入图像地址</div>
          <div class="url-import-bar">
            <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
            <button class="btn small" id="btnImportUrl">导入</button>
            <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>图像地址 (src) *</label><input id="fSrc" value="${escAttr(item.src||'')}" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/example.webp"/></div>
            <div class="form-group" style="flex:1"><label>日期</label><input id="fGalleryDate" type="date" value="${item.date||''}"/></div>
            <div class="form-group" style="flex:1"><label>同日序号</label><input id="fGalleryDayIndex" type="number" min="1" value="${item.dayIndex||''}" placeholder="自动" title="同一天内的顺序，1 = 当天最早；留空自动推导"/></div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>标题 *</label><input id="fGalleryTitle" value="${escAttr(item.title||'')}" placeholder="图像标题"/></div>
            <div class="form-group" style="flex:1"><label>替代文本 (alt)</label><input id="fAlt" value="${escAttr(item.alt||'')}" placeholder="屏幕阅读器描述"/></div>
          </div>
          <div class="form-group"><label>说明文字 (caption)</label><input id="fCaption" value="${escAttr(item.caption||'')}" placeholder="显示在图像下方的简短说明"/></div>
          <div class="form-group"><label>原图地址 (original)</label><input id="fOriginal" value="${escAttr(item.original||'')}" placeholder="上传自动填入；留空则画廊无「加载原图」按钮"/></div>
          <div class="form-row">
            <div class="form-group"><label>来源链接 (sourceUrl)</label><input id="fSourceUrl" value="${escAttr(item.sourceUrl||'')}" placeholder="https://..."/></div>
            <div class="form-group"><label>来源标题 (sourceTitle)</label><input id="fSourceTitle" value="${escAttr(item.sourceTitle||'')}" placeholder="来源名称"/></div>
          </div>
          <div style="margin-top:8px;padding:8px;background:var(--surface-2);border-radius:2px">
            <img src="${escAttr(item.src||'')}" alt="预览" style="max-width:100%;max-height:200px;display:block;margin:0 auto" onerror="this.style.display='none'" />
          </div>
        </div>`;
      ctx.setupUpload();
      ctx.setupGalleryMediaButton();
      if(!item.title) $('#fGalleryTitle')?.focus();
    }

    function newGalleryItem() {
      currentGalleryId = null;
      $('#editorTitle').textContent = '新建独立收藏';
      $('#btnDelete').style.display = 'none';
      $('#btnSave').disabled = false;
      const today = new Date().toISOString().split('T')[0];
      $('#editorContainer').innerHTML = `
        <div class="editor">
          <div class="upload-area" id="uploadArea">📎 拖放或点击上传图片 → 自动填入图像地址</div>
          <div class="url-import-bar">
            <input id="fImportUrl" placeholder="或粘贴外部图片 URL，点导入 →" />
            <button class="btn small" id="btnImportUrl">导入</button>
            <input id="fImportReferer" placeholder="防盗链 Referer（可选）" style="width:140px" title="如 Pixiv 需填 https://www.pixiv.net/" />
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>图像地址 (src) *</label><input id="fSrc" value="" placeholder="https://cdn.jsdelivr.net/gh/…@main/image/example.webp" autofocus/></div>
            <div class="form-group" style="flex:1"><label>日期</label><input id="fGalleryDate" type="date" value="${today}"/></div>
            <div class="form-group" style="flex:1"><label>同日序号</label><input id="fGalleryDayIndex" type="number" min="1" value="" placeholder="自动" title="同一天内的顺序，1 = 当天最早；留空自动推导"/></div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2"><label>标题 *</label><input id="fGalleryTitle" value="" placeholder="图像标题"/></div>
            <div class="form-group" style="flex:1"><label>替代文本 (alt)</label><input id="fAlt" value="" placeholder="屏幕阅读器描述"/></div>
          </div>
          <div class="form-group"><label>说明文字 (caption)</label><input id="fCaption" value="" placeholder="显示在图像下方的简短说明"/></div>
          <div class="form-group"><label>原图地址 (original)</label><input id="fOriginal" value="" placeholder="上传自动填入；留空则画廊无「加载原图」按钮"/></div>
          <div class="form-row">
            <div class="form-group"><label>来源链接 (sourceUrl)</label><input id="fSourceUrl" value="" placeholder="https://..."/></div>
            <div class="form-group"><label>来源标题 (sourceTitle)</label><input id="fSourceTitle" value="" placeholder="来源名称"/></div>
          </div>
        </div>`;
      ctx.setupUpload();
      ctx.setupGalleryMediaButton();
      renderGalleryList();
      $('#fGalleryTitle')?.focus();
    }

    async function saveGalleryItem() {
      const src = $('#fSrc')?.value?.trim() || '';
      const title = $('#fGalleryTitle')?.value?.trim() || '';
      if(!src){toast('图像地址不能为空');return}
      if(!title){toast('标题不能为空');return}

      const formData = new URLSearchParams();
      formData.set('src', src);
      formData.set('alt', $('#fAlt')?.value || '');
      formData.set('title', title);
      formData.set('caption', $('#fCaption')?.value || '');
      formData.set('original', $('#fOriginal')?.value || '');
      formData.set('date', $('#fGalleryDate')?.value || '');
      formData.set('dayIndex', $('#fGalleryDayIndex')?.value || '');
      formData.set('sourceUrl', $('#fSourceUrl')?.value || '');
      formData.set('sourceTitle', $('#fSourceTitle')?.value || '');
      formData.set('expectedHash', galleryHash);

      try {
        const url = currentGalleryId ? `${GALLERY_API}/${currentGalleryId}` : GALLERY_API;
        const method = currentGalleryId ? 'PUT' : 'POST';
        const res = await apiFetch(url, { method, body: formData, headers:{'Content-Type':'application/x-www-form-urlencoded'} });
        const data = await res.json();
        if(data.error){toast(data.error);return}
        if (data.contentHash) galleryHash = data.contentHash;
        toast(currentGalleryId?'已保存':'已创建');
        currentGalleryId = data.item?.id || currentGalleryId;
        await loadGallery();
        if (currentGalleryId) await selectGalleryItem(currentGalleryId);
      } catch(e) { toast('保存失败: '+e.message) }
    }

    async function deleteGalleryItem(id) {
      if(!confirm(`确定删除独立收藏「${id}」？此操作不可撤销。`)) return;
      try {
        const res = await apiFetch(`${GALLERY_API}/${id}?expectedHash=${encodeURIComponent(galleryHash)}`, { method:'DELETE' });
        const data = await res.json();
        if(data.error){toast(data.error);return}
        if (data.contentHash) galleryHash = data.contentHash;
        toast('已删除');
        if(currentGalleryId===id){currentGalleryId=null;$('#editorContainer').innerHTML='<div class="empty-state">← 从左侧列表选择图像，或点击「新建」</div>';$('#btnDelete').style.display='none';$('#btnSave').disabled=true;$('#editorTitle').textContent='选择或创建一幅图像'}
        await loadGallery();
      } catch(e) { toast('删除失败') }
    }

    // ═══════════════════════════════════════

export { loadGallery, renderGalleryList, newGalleryItem, saveGalleryItem, deleteGalleryItem };
