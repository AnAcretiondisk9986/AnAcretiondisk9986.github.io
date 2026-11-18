/**
 * 手机端发文助手（/write/）—— 03 日常（微信朋友圈样式）控制器
 * 支持：多选拍照/相册上传（blob 即时预览 + 直传 blog-images）、发布前指针拖拽排序九宫格、
 * 大图预览与 ALT 编辑、本地草稿防丢、从 GitHub 读取/编辑/删除 src/data/daily.json 并推送。
 */
import {
  MAX_MOMENT_IMAGES,
  createMomentsPhotoGrid,
  toLocalDateTimeValue,
  toShanghaiIsoOffset,
  sanitizeDailyEntry,
  sortDailyItems,
  extractHashtagsFromText,
  type MomentsGridController,
  type DailyMomentRecord,
} from '../../lib/daily-moments-grid.mjs';
import {
  isConfigured,
  uploadImageToRepo,
  readDailyJson,
  saveDailyJson,
} from './github-client';

const DAILY_DRAFT_KEY = 'hz-write-daily-draft-v1';
const QUICK_TAGS = ['碎片', '随手拍', '开发', '校园', '夜景', '咖啡', '阅读'];

export interface MobileDailyDeps {
  openSheet: (sel: string) => void;
  closeSheets: () => void;
  showToast: (msg: string) => void;
  isDailyActive: () => boolean;
  updateHeaderBadges: (draftText: string, statsText: string) => void;
  pollBuildProgress: (targetUrl?: string) => Promise<void>;
}

export interface MobileDailyController {
  refreshHeader: () => void;
  openDrawerList: () => Promise<void>;
  renderDrawerList: (q: string) => void;
  startNewMoment: (confirmIfDirty?: boolean) => void;
  publish: () => Promise<void>;
}

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

function parseTagsInput(raw: string): string[] {
  return [...new Set(
    String(raw || '')
      .split(/[,，、\s]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean),
  )];
}

export function createMobileDailyController(deps: MobileDailyDeps): MobileDailyController {
  const dailyMain = $('#mwDailyMain');
  const gridEl = $('#mwDailyGrid');
  const photoInputEl = $('#mwDailyPhotoInput') as HTMLInputElement | null;
  const textEl = $('#mwDailyText') as HTMLTextAreaElement | null;
  const locationEl = $('#mwDailyLocation') as HTMLInputElement | null;
  const tagsEl = $('#mwDailyTags') as HTMLInputElement | null;
  const deviceEl = $('#mwDailyDevice') as HTMLInputElement | null;
  const moodEl = $('#mwDailyMood') as HTMLInputElement | null;
  const createdAtEl = $('#mwDailyCreatedAt') as HTMLInputElement | null;
  const pinnedEl = $('#mwDailyPinned') as HTMLInputElement | null;
  const draftEl = $('#mwDailyDraft') as HTMLInputElement | null;
  const threadIdEl = $('#mwDailyThreadId') as HTMLInputElement | null;
  const threadLabelEl = $('#mwDailyThreadLabel') as HTMLInputElement | null;
  const linkLabelEl = $('#mwDailyLinkLabel') as HTMLInputElement | null;
  const linkTitleEl = $('#mwDailyLinkTitle') as HTMLInputElement | null;
  const linkUrlEl = $('#mwDailyLinkUrl') as HTMLInputElement | null;
  const linkDescEl = $('#mwDailyLinkDesc') as HTMLInputElement | null;
  const extraDetailsEl = $('#mwDailyExtraDetails') as HTMLDetailsElement | null;
  const delBtn = $('#btnMwDailyDelete') as HTMLButtonElement | null;
  const modePill = $('#mwDailyModeLabel');
  const resetBtn = $('#btnMwDailyReset');
  const chipWrap = $('#mwDailyTagChips');

  let editingId: string | null = null;
  let remoteItems: DailyMomentRecord[] = [];
  let dirty = false;
  let draftTimer = 0;
  let publishing = false;

  const localPreviewMap = new Map<string, string>();
  const resolvePreviewSrc = (item: { src: string; previewUrl?: string }) =>
    item.previewUrl || localPreviewMap.get(item.src) || item.src || '';

  let grid: MomentsGridController | null = null;

  function openMobileImageModal(
    item: { src: string; alt: string; previewUrl?: string },
    idx: number,
    items: Array<{ uid?: string; src: string; alt: string; previewUrl?: string }>,
    sync: () => void,
  ) {
    const imgEl = $('#mwDailyImgPreview') as HTMLImageElement | null;
    const titleEl = $('#mwDailyImgTitle');
    const altInput = $('#mwDailyImgAlt') as HTMLInputElement | null;
    const doneBtn = $('#btnMwDailyImgDone');
    const removeBtn = $('#btnMwDailyImgRemove');
    if (titleEl) titleEl.textContent = `第 ${idx + 1} / ${items.length} 张配图`;
    if (imgEl) {
      imgEl.src = resolvePreviewSrc(item);
      imgEl.alt = item.alt || '';
    }
    if (altInput) altInput.value = item.alt || '';

    if (doneBtn) {
      doneBtn.onclick = () => {
        item.alt = (altInput?.value || '').trim();
        sync();
        deps.closeSheets();
      };
    }
    if (removeBtn) {
      removeBtn.onclick = () => {
        const uid = (item as { uid?: string }).uid;
        if (uid && gridEl) {
          const tileDel = gridEl.querySelector(`.mom-tile[data-uid="${uid}"] .mom-tile__del`) as HTMLButtonElement | null;
          tileDel?.click();
        }
        deps.closeSheets();
      };
    }
    deps.openSheet('#mwDailyImgSheet');
  }

  if (gridEl) {
    grid = createMomentsPhotoGrid({
      gridEl,
      fileInputEl: photoInputEl,
      maxImages: MAX_MOMENT_IMAGES,
      uploadFile: async (file, onProgress) => {
        if (!isConfigured()) {
          throw new Error('请先连接 GitHub');
        }
        onProgress(20);
        const uploaded = await uploadImageToRepo(file);
        onProgress(95);
        if (uploaded.url && uploaded.previewUrl) {
          localPreviewMap.set(uploaded.url, uploaded.previewUrl);
        }
        return uploaded;
      },
      resolvePreviewSrc,
      onChange: () => {
        markDirty();
        refreshHeader();
      },
      onToast: (msg) => deps.showToast(msg),
      onPreview: openMobileImageModal as unknown as Parameters<typeof createMomentsPhotoGrid>[0]['onPreview'],
    });
  }

  function refreshHeader() {
    if (!deps.isDailyActive()) return;
    const chars = (textEl?.value || '').trim().length;
    const count = grid?.getCount() || 0;
    const badge = editingId
      ? (dirty ? '日常·未推' : '编辑日常')
      : (dirty ? '日常草稿' : '新日常');
    deps.updateHeaderBadges(badge, `${chars}字 · ${count}/9图`);
    if (modePill) {
      modePill.textContent = editingId ? `编辑中 · ${editingId}` : '发布新日常 · 微信朋友圈模式';
    }
    if (resetBtn) resetBtn.hidden = !editingId && !dirty;
    if (delBtn) delBtn.hidden = !editingId;
  }

  function collectFormPayload() {
    const text = (textEl?.value || '').replace(/\r\n?/g, '\n');
    const images = grid ? grid.getImages() : [];
    const manualTags = parseTagsInput(tagsEl?.value || '');
    const hashTags = extractHashtagsFromText(text);
    const tags = [...new Set([...manualTags, ...hashTags])];
    const linkUrl = (linkUrlEl?.value || '').trim();
    return {
      text: text.trimEnd(),
      images,
      tags,
      createdAt: toShanghaiIsoOffset(createdAtEl?.value || ''),
      location: (locationEl?.value || '').trim(),
      device: (deviceEl?.value || '').trim(),
      mood: (moodEl?.value || '').trim(),
      pinned: Boolean(pinnedEl?.checked),
      draft: Boolean(draftEl?.checked),
      threadId: (threadIdEl?.value || '').trim(),
      threadLabel: (threadLabelEl?.value || '').trim(),
      ...(linkUrl
        ? {
            linkCard: {
              title: (linkTitleEl?.value || '').trim() || linkUrl,
              url: linkUrl,
              label: (linkLabelEl?.value || '').trim(),
              description: (linkDescEl?.value || '').trim(),
            },
          }
        : {}),
    };
  }

  function saveLocalDraft() {
    try {
      const payload = collectFormPayload();
      localStorage.setItem(DAILY_DRAFT_KEY, JSON.stringify({
        editingId,
        payload,
        updatedAt: Date.now(),
      }));
    } catch { /* ignore */ }
  }

  function clearLocalDraft() {
    try { localStorage.removeItem(DAILY_DRAFT_KEY); } catch { /* ignore */ }
  }

  function markDirty() {
    dirty = true;
    refreshHeader();
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveLocalDraft, 320);
  }

  function applyEntryToForm(entry: Partial<DailyMomentRecord> | null, { fromDraft = false } = {}) {
    editingId = entry?.id || null;
    if (textEl) textEl.value = entry?.text || '';
    if (locationEl) locationEl.value = entry?.location || '';
    if (tagsEl) tagsEl.value = Array.isArray(entry?.tags) ? entry.tags.join(', ') : '';
    if (deviceEl) deviceEl.value = entry?.device || '';
    if (moodEl) moodEl.value = entry?.mood || '';
    if (createdAtEl) createdAtEl.value = toLocalDateTimeValue(entry?.createdAt || new Date().toISOString());
    if (pinnedEl) pinnedEl.checked = Boolean(entry?.pinned);
    if (draftEl) draftEl.checked = Boolean(entry?.draft);
    if (threadIdEl) threadIdEl.value = entry?.threadId || '';
    if (threadLabelEl) threadLabelEl.value = entry?.threadLabel || '';
    if (linkLabelEl) linkLabelEl.value = entry?.linkCard?.label || '';
    if (linkTitleEl) linkTitleEl.value = entry?.linkCard?.title || '';
    if (linkUrlEl) linkUrlEl.value = entry?.linkCard?.url || '';
    if (linkDescEl) linkDescEl.value = entry?.linkCard?.description || '';
    if (extraDetailsEl) {
      extraDetailsEl.open = Boolean(entry?.threadId || entry?.threadLabel || entry?.linkCard?.url);
    }
    grid?.setImages(entry?.images || []);
    dirty = fromDraft;
    refreshHeader();
  }

  function startNewMoment(confirmIfDirty = true) {
    if (confirmIfDirty && dirty && !window.confirm('当前日常尚未发布，确定清空重写？')) return;
    clearLocalDraft();
    applyEntryToForm(null, { fromDraft: false });
    deps.closeSheets();
    deps.showToast('已切换到新日常');
  }

  function restoreDraftIfAny() {
    try {
      const raw = localStorage.getItem(DAILY_DRAFT_KEY);
      if (!raw) {
        applyEntryToForm(null, { fromDraft: false });
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.payload) {
        applyEntryToForm(null, { fromDraft: false });
        return;
      }
      const hasContent = Boolean(parsed.payload.text?.trim() || parsed.payload.images?.length);
      if (!hasContent) {
        applyEntryToForm(null, { fromDraft: false });
        return;
      }
      applyEntryToForm({ id: parsed.editingId || undefined, ...parsed.payload }, { fromDraft: true });
    } catch {
      applyEntryToForm(null, { fromDraft: false });
    }
  }

  function renderDrawerList(q: string) {
    const listEl = $('#mwPostsList');
    if (!listEl) return;
    const needle = q.trim().toLowerCase();
    const list = remoteItems.filter((it) => {
      if (!needle) return true;
      const hay = [it.id, it.text, it.location, ...(it.tags || [])].filter(Boolean).join('\n').toLowerCase();
      return hay.includes(needle);
    });
    if (!list.length) {
      listEl.innerHTML = '<div class="mw-empty">没有匹配的日常记录</div>';
      return;
    }
    listEl.innerHTML = '';
    list.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mw-post-row mw-post-row--daily${editingId === item.id ? ' active' : ''}`;
      const snippet = (item.text || '').replace(/\s+/g, ' ').trim()
        || (item.images?.length ? `分享了 ${item.images.length} 张照片` : item.id);
      const dateLabel = toLocalDateTimeValue(item.createdAt).replace('T', ' ');
      const imgCount = item.images?.length || 0;
      const metaParts = [dateLabel];
      if (imgCount) metaParts.push(`${imgCount}图`);
      if (item.pinned) metaParts.push('置顶');
      if (item.draft) metaParts.push('草稿');

      const titleDiv = document.createElement('div');
      titleDiv.className = 'mw-post-row__title';
      titleDiv.textContent = snippet;
      const metaDiv = document.createElement('div');
      metaDiv.className = 'mw-post-row__meta';
      metaDiv.textContent = metaParts.join(' · ');
      btn.append(titleDiv, metaDiv);
      btn.onclick = () => {
        if (dirty && editingId !== item.id && !window.confirm('当前有未发布修改，确定载入该条日常？')) return;
        clearLocalDraft();
        applyEntryToForm(item, { fromDraft: false });
        deps.closeSheets();
      };
      listEl.appendChild(btn);
    });
  }

  async function openDrawerList() {
    deps.openSheet('#mwPostsSheet');
    const listEl = $('#mwPostsList');
    if (!isConfigured()) {
      if (listEl) listEl.innerHTML = '<div class="mw-empty">请先点右上角「设置」连接 GitHub</div>';
      return;
    }
    if (listEl) listEl.innerHTML = '<div class="mw-empty">读取 03 日常数据…</div>';
    try {
      const { items } = await readDailyJson();
      remoteItems = sortDailyItems(items);
      renderDrawerList((($('#mwPostsSearch') as HTMLInputElement | null)?.value) || '');
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="mw-empty">读取失败：${(err as Error).message}</div>`;
    }
  }

  async function publish() {
    if (publishing) return;
    if (!isConfigured()) {
      deps.showToast('请先配置 GitHub 连接');
      deps.openSheet('#mwSettingsSheet');
      return;
    }
    if (grid?.hasPendingUploads()) {
      deps.showToast('正在等待配图上传…');
      const ok = await grid.waitForUploads();
      if (!ok) {
        deps.showToast('部分配图上传失败，请重传或移除');
        return;
      }
    }
    if (grid?.hasErrors()) {
      deps.showToast('存在上传失败的图片，请重传或删除');
      return;
    }

    const payload = collectFormPayload();
    if (!payload.text.trim() && payload.images.length === 0) {
      deps.showToast('写点内容或选几张照片再发吧');
      textEl?.focus();
      return;
    }

    publishing = true;
    const pubBtn = $('#btnMwPublish') as HTMLButtonElement | null;
    if (pubBtn) { pubBtn.disabled = true; pubBtn.textContent = '推送中…'; }

    try {
      const commitOnce = async () => {
        const { items, sha } = await readDailyJson();
        const nextEntry = sanitizeDailyEntry({
          ...(editingId ? { id: editingId } : {}),
          ...payload,
        }, items) as DailyMomentRecord;

        const merged = editingId
          ? (items.some((x) => x.id === editingId)
            ? items.map((x) => (x.id === editingId ? nextEntry : x))
            : [nextEntry, ...items])
          : [nextEntry, ...items];
        const sorted = sortDailyItems(merged);
        await saveDailyJson({
          items: sorted,
          sha,
          message: `mobile daily ${editingId ? 'update' : 'post'}: ${nextEntry.id}`,
        });
        return { sorted, nextEntry };
      };

      let result;
      try {
        result = await commitOnce();
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 409 || status === 422) {
          result = await commitOnce();
        } else {
          throw err;
        }
      }

      remoteItems = result.sorted;
      editingId = result.nextEntry.id;
      dirty = false;
      clearLocalDraft();
      refreshHeader();
      deps.showToast('已发表日常到 main，GitHub Actions 构建中…');
      deps.closeSheets();
      deps.pollBuildProgress('https://blog.acretiondisk.top/daily/');
    } catch (err) {
      deps.showToast(`发布失败：${(err as Error).message}`);
    } finally {
      publishing = false;
      if (pubBtn) { pubBtn.disabled = false; pubBtn.textContent = '发布 ↑'; }
    }
  }

  async function deleteRemoteMoment() {
    if (!editingId) return;
    if (!isConfigured()) {
      deps.openSheet('#mwSettingsSheet');
      return;
    }
    if (!window.confirm(`确定从 GitHub 删除日常「${editingId}」？`)) return;
    try {
      const { items, sha } = await readDailyJson();
      const next = items.filter((x) => x.id !== editingId);
      await saveDailyJson({
        items: next,
        sha,
        message: `mobile delete daily: ${editingId}`,
      });
      remoteItems = sortDailyItems(next);
      clearLocalDraft();
      applyEntryToForm(null, { fromDraft: false });
      deps.showToast('已从 GitHub 删除该日常');
      deps.pollBuildProgress('https://blog.acretiondisk.top/daily/');
    } catch (err) {
      deps.showToast(`删除失败：${(err as Error).message}`);
    }
  }

  if (chipWrap) {
    chipWrap.innerHTML = QUICK_TAGS.map((t) => `<button type="button" class="mom-chip" data-mw-dtag="${t}">#${t}</button>`).join('');
    chipWrap.addEventListener('click', (e) => {
      const btn = (e.target as Element)?.closest('[data-mw-dtag]') as HTMLElement | null;
      const tag = btn?.dataset.mwDtag;
      if (!tag || !tagsEl) return;
      const existing = parseTagsInput(tagsEl.value);
      const next = existing.includes(tag)
        ? existing.filter((x) => x !== tag)
        : [...existing, tag];
      tagsEl.value = next.join(', ');
      markDirty();
    });
  }

  $('#btnMwDailyPick')?.addEventListener('click', () => grid?.openPicker());
  resetBtn?.addEventListener('click', () => startNewMoment(true));
  delBtn?.addEventListener('click', deleteRemoteMoment);

  dailyMain?.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });

  restoreDraftIfAny();

  return {
    refreshHeader,
    openDrawerList,
    renderDrawerList,
    startNewMoment,
    publish,
  };
}
