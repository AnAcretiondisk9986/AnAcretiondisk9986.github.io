/**
 * 前端定制：主题、首屏文案/图片、颜色与玻璃材质（src/data/frontend.json）。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const FRONTEND_API = '/api/frontend';
let frontendHash = '';
let ctx = {
  setupUpload: () => {},
  setUploadField: () => {},
  /** 主模块的上传实现：内部按 currentMode 路由到 frontendUploadField 指定的字段 */
  uploadImage: async () => {},
};

export function initFrontend(options = {}) { ctx = { ...ctx, ...options }; }

    function renderFrontendList() {
      $('#postList').innerHTML = `
        <div style="padding:12px 14px;font-size:11px;color:var(--text-faint);line-height:1.9">
          <div style="color:var(--accent);margin-bottom:4px">◐ 前端定制</div>
          <div>主题、首屏文案与背景图片</div>
          <div>玻璃材质、圆角与主题色</div>
        </div>`;
    }

    async function loadFrontend() {
      try {
        const res = await apiFetch(FRONTEND_API);
        const data = await res.json();
        if (data.error) { toast(data.error); return; }
        frontendHash = data.contentHash || '';
        renderFrontendEditor(data);
      } catch (e) { toast('加载前端配置失败: ' + e.message); }
    }

    function frontendPositionOptions(value) {
      return [
        ['center', '居中'],
        ['center top', '居中靠上'],
        ['center bottom', '居中靠下'],
        ['left center', '左侧居中'],
        ['right center', '右侧居中'],
      ].map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('');
    }

    function renderFrontendEditor(data) {
      data = data || {};
      $('#editorTitle').textContent = '前端定制';
      $('#btnDelete').style.display = 'none';
      $('#btnSave').disabled = false;
      $('#editorContainer').innerHTML = `
        <div class="editor frontend-editor">
          <div class="frontend-preview" id="frontendHeroPreview" aria-label="首页首屏预览">
            <img id="frontendPreviewImg" alt="" />
            <span class="frontend-preview__scrim" id="frontendPreviewScrim"></span>
            <div class="frontend-preview-copy">
              <small id="frontendPreviewEyebrow"></small>
              <b id="frontendPreviewTitle"></b>
              <p id="frontendPreviewDesc"></p>
            </div>
            <span class="frontend-preview-badge">首页首屏预览</span>
          </div>

          <section class="frontend-section">
            <h3>站点与默认主题</h3>
            <div class="form-row">
              <div class="form-group"><label>默认视觉主题</label><select id="fDefaultVisualTheme">
                <option value="cyanotype"${data.defaultVisualTheme === 'cyanotype' ? ' selected' : ''}>蓝晒 · 观察工作纸</option>
                <option value="still"${data.defaultVisualTheme === 'still' ? ' selected' : ''}>静澈 · Liquid Glass</option>
                <option value="fluid"${data.defaultVisualTheme === 'fluid' ? ' selected' : ''}>流形 · Liquid Glass</option>
                <option value="minimal"${data.defaultVisualTheme === 'minimal' ? ' selected' : ''}>留白</option>
                <option value="trace"${data.defaultVisualTheme === 'trace' ? ' selected' : ''}>行迹</option>
              </select></div>
              <div class="form-group"><label>标题字体</label><select id="fDisplayFont">
                <option value="noto-serif"${data.displayFont === 'noto-serif' ? ' selected' : ''}>Noto Serif 风格</option>
                <option value="noto-sans"${data.displayFont === 'noto-sans' ? ' selected' : ''}>Noto Sans 风格</option>
              </select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>站点名称</label><input id="fSiteName" value="${escAttr(data.siteName || '')}" /></div>
              <div class="form-group"><label>站点短句</label><input id="fSiteTagline" value="${escAttr(data.siteTagline || '')}" /></div>
            </div>
          </section>

          <section class="frontend-section">
            <h3>首页首屏内容</h3>
            <div class="form-group"><label>眉题</label><input id="fHeroEyebrow" value="${escAttr(data.heroEyebrow || '')}" /></div>
            <div class="form-row">
              <div class="form-group"><label>标题第一行</label><input id="fHeroTitleLine1" value="${escAttr(data.heroTitleLine1 || '')}" /></div>
              <div class="form-group"><label>标题第二行</label><input id="fHeroTitleLine2" value="${escAttr(data.heroTitleLine2 || '')}" /></div>
            </div>
            <div class="form-group"><label>首屏描述</label><textarea id="fHeroDescription" style="min-height:64px">${esc(data.heroDescription || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label>主按钮文字</label><input id="fPrimaryCtaLabel" value="${escAttr(data.primaryCtaLabel || '')}" /></div>
              <div class="form-group"><label>主按钮链接</label><input id="fPrimaryCtaHref" value="${escAttr(data.primaryCtaHref || '')}" /></div>
            </div>
          </section>

          <section class="frontend-section">
            <h3>首页首屏背景图</h3>
            <div class="upload-area" data-frontend-upload="fStillHeroImage">上传首屏背景图片（拖放或点击选择）</div>
            <div class="form-row" style="margin-top:10px">
              <div class="form-group"><label>图片地址</label><input id="fStillHeroImage" value="${escAttr(data.stillHeroImage || '')}" /></div>
              <div class="form-group"><label>图片焦点</label><select id="fStillImagePosition">${frontendPositionOptions(data.stillImagePosition)}</select></div>
            </div>
            <div class="field-hint">首页首屏共用这一张图，站内其它页面不使用。</div>
          </section>

          <section class="frontend-section">
            <h3>色彩与玻璃材质</h3>
            <div class="field-hint" style="margin-bottom:8px">仅对「静澈 / 流形」两套视觉主题生效；蓝晒、留白、行迹不受影响。</div>
            <div class="form-row">
              <div class="form-group"><label>静澈强调色</label><input id="fStillAccent" type="color" value="${escAttr(data.stillAccent || 'var(--danger)')}" /></div>
              <div class="form-group"><label>流形主色</label><input id="fFluidPrimary" type="color" value="${escAttr(data.fluidPrimary || 'var(--ok)')}" /></div>
              <div class="form-group"><label>流形辅助色</label><input id="fFluidSecondary" type="color" value="${escAttr(data.fluidSecondary || 'var(--danger)')}" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>静澈玻璃不透明度</label><div class="frontend-range"><input id="fStillGlassOpacity" type="range" min="0.15" max="1" step="0.01" value="${Number(data.stillGlassOpacity ?? .84)}" /><output id="vStillGlassOpacity"></output></div></div>
              <div class="form-group"><label>流形玻璃不透明度</label><div class="frontend-range"><input id="fFluidGlassOpacity" type="range" min="0.15" max="1" step="0.01" value="${Number(data.fluidGlassOpacity ?? .8)}" /><output id="vFluidGlassOpacity"></output></div></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>背景遮罩</label><div class="frontend-range"><input id="fHeroOverlayOpacity" type="range" min="0.18" max="0.62" step="0.01" value="${Number(data.heroOverlayOpacity ?? .34)}" /><output id="vHeroOverlayOpacity"></output></div></div>
              <div class="form-group"><label>玻璃模糊</label><div class="frontend-range"><input id="fGlassBlur" type="range" min="10" max="32" step="1" value="${Number(data.glassBlur ?? 20)}" /><output id="vGlassBlur"></output></div></div>
              <div class="form-group"><label>卡片圆角</label><div class="frontend-range"><input id="fCardRadius" type="range" min="2" max="8" step="1" value="${Number(data.cardRadius ?? 8)}" /><output id="vCardRadius"></output></div></div>
            </div>
          </section>
        </div>`;

      setupFrontendUpload();
      document.querySelectorAll('.frontend-editor input, .frontend-editor textarea, .frontend-editor select').forEach(el => {
        el.addEventListener('input', syncFrontendPreview);
        el.addEventListener('change', syncFrontendPreview);
      });
      syncFrontendPreview();
    }

    function setupFrontendUpload() {
      document.querySelectorAll('[data-frontend-upload]').forEach(area => {
        const choose = () => {
          ctx.setUploadField(area.dataset.frontendUpload);
          $('#fileInput').click();
        };
        area.onclick = choose;
        area.ondragover = e => { e.preventDefault(); area.classList.add('dragover'); };
        area.ondragleave = () => area.classList.remove('dragover');
        area.ondrop = async e => {
          e.preventDefault();
          area.classList.remove('dragover');
          ctx.setUploadField(area.dataset.frontendUpload);
          const file = e.dataTransfer.files[0];
          if (file) await ctx.uploadImage(file);
        };
      });
      // #fileInput.onchange 与 document.onpaste 由主模块 setupUpload 统一接管：
      // 它按 currentMode === 'frontend' + frontendUploadField 路由目标字段。
      // 此处曾二次覆盖这两个全局处理器，导致离开「前端定制」后的上传被静默吞掉。
    }

    /**
     * 预览：用与首页一致的渲染方式（<img> + object-position + 遮罩层 + 文案层级），
     * 而不是此前那种 background-image 假预览——那时后台看到的和线上并不一样。
     */
    function syncFrontendPreview() {
      const img = $('#frontendPreviewImg');
      if (img) {
        const url = $('#fStillHeroImage')?.value?.trim() || '';
        if (url) img.src = url; else img.removeAttribute('src');
        img.style.objectPosition = $('#fStillImagePosition')?.value || 'center';
      }
      const scrim = $('#frontendPreviewScrim');
      if (scrim) scrim.style.opacity = String(Number($('#fHeroOverlayOpacity')?.value || .34));

      const eyebrow = $('#fHeroEyebrow')?.value || '';
      const title = [$('#fHeroTitleLine1')?.value || '', $('#fHeroTitleLine2')?.value || ''].filter(Boolean).join(' ');
      const desc = $('#fHeroDescription')?.value || '';
      const setText = (id, text) => { const el = $('#' + id); if (el) el.textContent = text; };
      setText('frontendPreviewEyebrow', eyebrow);
      setText('frontendPreviewTitle', title);
      setText('frontendPreviewDesc', desc);

      const previewFont = $('#fDisplayFont')?.value === 'noto-sans'
        ? '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif'
        : '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif';
      const titleEl = $('#frontendPreviewTitle');
      if (titleEl) titleEl.style.fontFamily = previewFont;

      const outputs = [
        ['vStillGlassOpacity', 'fStillGlassOpacity', ''],
        ['vFluidGlassOpacity', 'fFluidGlassOpacity', ''],
        ['vHeroOverlayOpacity', 'fHeroOverlayOpacity', ''],
        ['vGlassBlur', 'fGlassBlur', ' px'],
        ['vCardRadius', 'fCardRadius', ' px'],
      ];
      outputs.forEach(([outId, inputId, suffix]) => { const out = $('#' + outId); if (out) out.textContent = (outId.includes('Opacity') ? Math.round(Number($('#' + inputId)?.value || 0) * 100) + '%' : ($('#' + inputId)?.value || '') + suffix); });
    }

    async function saveFrontend() {
      const fields = {
        defaultVisualTheme: '#fDefaultVisualTheme', siteName: '#fSiteName', siteTagline: '#fSiteTagline',
        heroEyebrow: '#fHeroEyebrow', heroTitleLine1: '#fHeroTitleLine1', heroTitleLine2: '#fHeroTitleLine2',
        heroDescription: '#fHeroDescription', primaryCtaLabel: '#fPrimaryCtaLabel', primaryCtaHref: '#fPrimaryCtaHref',
        stillHeroImage: '#fStillHeroImage', stillImagePosition: '#fStillImagePosition',
        displayFont: '#fDisplayFont', stillAccent: '#fStillAccent', fluidPrimary: '#fFluidPrimary', fluidSecondary: '#fFluidSecondary',
        stillGlassOpacity: '#fStillGlassOpacity', fluidGlassOpacity: '#fFluidGlassOpacity', heroOverlayOpacity: '#fHeroOverlayOpacity',
        glassBlur: '#fGlassBlur', cardRadius: '#fCardRadius',
      };
      const body = new URLSearchParams();
      Object.entries(fields).forEach(([key, selector]) => body.set(key, $(selector)?.value ?? ''));
      body.set('expectedHash', frontendHash);
      try {
        const res = await apiFetch(FRONTEND_API, { method: 'PUT', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const data = await res.json();
        if (data.error) { toast(data.error); return; }
        frontendHash = data.contentHash || frontendHash;
        toast('前端定制已保存');
        renderFrontendEditor(data.frontend);
      } catch (e) { toast('保存失败: ' + e.message); }
    }


export { renderFrontendList, loadFrontend, saveFrontend, syncFrontendPreview };
