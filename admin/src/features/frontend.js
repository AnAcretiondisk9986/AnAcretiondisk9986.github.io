/**
 * 外观与首页配置（src/data/frontend.json）：
 * 对齐 HORIZON 主站实际消费的 8 个全站标识与视界首屏字段。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';

const FRONTEND_API = '/api/frontend';
let frontendHash = '';
let frontendBaseline = '';
let frontendDirty = false;
let frontendEditorActive = false;
let frontendSaving = false;
let ctx = {
  onDirtyChange: () => {},
  refreshSyncStatus: async () => null,
};

export function initFrontend(options = {}) { ctx = { ...ctx, ...options }; }
export function isFrontendDirty() { return frontendDirty; }
export function clearFrontendDirty() { frontendDirty = false; frontendBaseline = ''; frontendEditorActive = false; ctx.onDirtyChange(false); }

const FRONTEND_FIELD_SELECTORS = {
  siteName: '#fSiteName',
  siteTagline: '#fSiteTagline',
  heroEyebrow: '#fHeroEyebrow',
  heroTitleLine1: '#fHeroTitleLine1',
  heroTitleLine2: '#fHeroTitleLine2',
  heroDescription: '#fHeroDescription',
  primaryCtaLabel: '#fPrimaryCtaLabel',
  primaryCtaHref: '#fPrimaryCtaHref',
};

const QUICK_ROUTES = [
  ['/blog/', '文章光谱'],
  ['/gallery/', '图像档案'],
  ['/about/', '关于档案'],
  ['/academics/', '学业轨迹'],
  ['/schedule/', '日程课表'],
  ['/ai-quota/', '算力额度'],
];

function readFrontendFormSnapshot() {
  const obj = {};
  Object.entries(FRONTEND_FIELD_SELECTORS).forEach(([k, sel]) => { obj[k] = $(sel)?.value ?? ''; });
  return JSON.stringify(obj);
}

function syncFrontendDirty() {
  if (!frontendEditorActive || !$('#fSiteName')) return;
  const next = readFrontendFormSnapshot() !== frontendBaseline;
  if (next !== frontendDirty) {
    frontendDirty = next;
    ctx.onDirtyChange(frontendDirty);
  }
}

function markFrontendBaseline() {
  frontendEditorActive = true;
  frontendBaseline = readFrontendFormSnapshot();
  frontendDirty = false;
  ctx.onDirtyChange(false);
}

function renderFrontendList() {
  $('#postList').innerHTML = `
    <div style="padding:12px 14px;font-size:11px;color:var(--text-faint);line-height:1.9">
      <div style="color:var(--accent);margin-bottom:4px">05 · 外观与首屏</div>
      <div>编辑全站 HUD 标识与首页视界首屏文案。</div>
      <div>全站视觉已统一为 HORIZON（VOID 暗色 / PLATE 底片），旧版背景图与玻璃参数已自动下线。</div>
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

function splitHorizonTitle(raw) {
  const text = String(raw || '').trim();
  const idx = text.search(/[A-Za-z0-9]/);
  if (idx > 0) return { cjk: text.slice(0, idx).trim(), latin: text.slice(idx).trim() };
  return { cjk: text, latin: '' };
}

function renderFrontendEditor(data) {
  data = data || {};
  $('#editorTitle').textContent = '外观与首页首屏';
  $('#btnDelete').style.display = 'none';
  $('#btnSave').disabled = false;
  $('#editorContainer').innerHTML = `
    <div class="editor frontend-editor">
      <div class="frontend-preview" id="frontendHeroPreview" aria-label="HORIZON 首屏实时预览">
        <div class="frontend-preview__hud">
          <div class="frontend-preview__brand">
            <b id="frontendPreviewSiteName"></b>
            <span id="frontendPreviewTagline"></span>
          </div>
          <span class="frontend-preview-badge">HORIZON · 首屏实时预览</span>
        </div>
        <div class="frontend-preview-copy">
          <small id="frontendPreviewEyebrow"></small>
          <div class="frontend-preview-title" id="frontendPreviewTitle">
            <span class="hz-p-l1" id="frontendPreviewL1"></span>
            <span class="hz-p-domain" id="frontendPreviewDomain"></span>
            <span class="hz-p-l2" id="frontendPreviewL2"></span>
          </div>
          <p id="frontendPreviewDesc"></p>
          <div class="frontend-preview-actions">
            <span class="frontend-preview-cta" id="frontendPreviewCta"></span>
            <span class="frontend-preview-cta frontend-preview-cta--ghost">进入透镜图志 ↗</span>
          </div>
        </div>
      </div>

      <section class="frontend-section">
        <h3>全站 HUD 标识</h3>
        <div class="form-row">
          <div class="form-group"><label>站点名称 (siteName)</label><input id="fSiteName" value="${escAttr(data.siteName || '')}" placeholder="Acretiondisk" /></div>
          <div class="form-group"><label>站点副标 (siteTagline)</label><input id="fSiteTagline" value="${escAttr(data.siteTagline || '')}" placeholder="记录想法与生活" /></div>
        </div>
        <div class="field-hint">显示在全站顶部 HUD 导航左侧、浏览器标签页与页脚；主站支持访客随时切换 VOID 暗色 / PLATE 底片主题。</div>
      </section>

      <section class="frontend-section">
        <h3>首页黑洞视界首屏</h3>
        <div class="form-group"><label>眉题 (heroEyebrow)</label><input id="fHeroEyebrow" value="${escAttr(data.heroEyebrow || '')}" placeholder="PERSONAL ARCHIVE · 2026" /></div>
        <div class="form-row">
          <div class="form-group"><label>主标题第一行 (heroTitleLine1)</label><input id="fHeroTitleLine1" value="${escAttr(data.heroTitleLine1 || '')}" placeholder="欢迎来到Blog.Acretiondisk.top" /></div>
          <div class="form-group"><label>主标题第二行 (heroTitleLine2)</label><input id="fHeroTitleLine2" value="${escAttr(data.heroTitleLine2 || '')}" placeholder="这是我的个人网站" /></div>
        </div>
        <div class="field-hint">主站会在第一行的首个英文/数字字符处自动拆行，并将英文域名段以橙色高亮展示（如上方预览）。</div>
        <div class="form-group"><label>首屏导语 (heroDescription)</label><textarea id="fHeroDescription" style="min-height:64px">${esc(data.heroDescription || '')}</textarea></div>
        <div class="form-row">
          <div class="form-group"><label>主按钮文案 (primaryCtaLabel)</label><input id="fPrimaryCtaLabel" value="${escAttr(data.primaryCtaLabel || '')}" placeholder="浏览文章" /></div>
          <div class="form-group">
            <label>主按钮链接 (primaryCtaHref)</label>
            <input id="fPrimaryCtaHref" value="${escAttr(data.primaryCtaHref || '')}" placeholder="/blog/" />
            <div class="frontend-quick-links">
              ${QUICK_ROUTES.map(([href, label]) => `<button class="btn small" type="button" data-cta-route="${escAttr(href)}">${esc(label)} (${esc(href)})</button>`).join('')}
            </div>
          </div>
        </div>
      </section>
    </div>`;

  document.querySelectorAll('.frontend-editor input, .frontend-editor textarea').forEach((el) => {
    el.addEventListener('input', () => { syncFrontendPreview(); syncFrontendDirty(); });
    el.addEventListener('change', () => { syncFrontendPreview(); syncFrontendDirty(); });
  });
  document.querySelectorAll('[data-cta-route]').forEach((btn) => {
    btn.onclick = () => {
      const input = $('#fPrimaryCtaHref');
      if (!input) return;
      input.value = btn.dataset.ctaRoute;
      syncFrontendPreview();
      syncFrontendDirty();
    };
  });
  syncFrontendPreview();
  markFrontendBaseline();
}

function syncFrontendPreview() {
  const setText = (id, text) => { const el = $('#' + id); if (el) el.textContent = text; };
  setText('frontendPreviewSiteName', $('#fSiteName')?.value || 'Acretiondisk');
  setText('frontendPreviewTagline', $('#fSiteTagline')?.value || '');
  setText('frontendPreviewEyebrow', $('#fHeroEyebrow')?.value || '');

  const { cjk, latin } = splitHorizonTitle($('#fHeroTitleLine1')?.value || '');
  setText('frontendPreviewL1', cjk);
  const domainEl = $('#frontendPreviewDomain');
  if (domainEl) {
    domainEl.textContent = latin;
    domainEl.hidden = !latin;
  }
  const l2 = $('#fHeroTitleLine2')?.value || '';
  const l2El = $('#frontendPreviewL2');
  if (l2El) {
    l2El.textContent = l2;
    l2El.hidden = !l2;
  }
  setText('frontendPreviewDesc', $('#fHeroDescription')?.value || '');
  const ctaLabel = $('#fPrimaryCtaLabel')?.value?.trim() || '浏览文章';
  setText('frontendPreviewCta', `${ctaLabel} →`);
}

async function saveFrontend() {
  if (frontendSaving) return;
  const saveBtn = $('#btnSave');
  frontendSaving = true;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 保存中…'; }
  const body = new URLSearchParams();
  Object.entries(FRONTEND_FIELD_SELECTORS).forEach(([key, selector]) => body.set(key, $(selector)?.value ?? ''));
  body.set('expectedHash', frontendHash);
  try {
    const res = await apiFetch(FRONTEND_API, { method: 'PUT', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (res.status === 409) { toast('外观配置已被其他来源修改，请点「↻ 刷新」获取最新后再保存'); return; }
      toast(data.error || `保存失败（HTTP ${res.status}）`);
      return;
    }
    frontendHash = data.contentHash || frontendHash;
    clearFrontendDirty();
    toast('外观配置已保存（点顶栏「发布」上线）');
    ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
    renderFrontendEditor(data.frontend);
  } catch (e) { toast('保存失败: ' + e.message); }
  finally {
    frontendSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存 (Ctrl+S)'; }
  }
}

export { renderFrontendList, loadFrontend, saveFrontend, syncFrontendPreview, syncFrontendDirty };
