/**
 * 文章大类管理 + 批量归类（src/data/categories.json）。
 * 支持新增 / 重命名（级联更新所有 Markdown frontmatter） / 删除（可选级联移除） / 多选文章批量归类。
 */
import { $, esc, escAttr } from '../ui/dom.js';
import { toast } from '../ui/app-toast.js';
import { apiFetch } from '../api/app-client.js';
import { openModal, closeModal } from '../ui/modal.js';

const CATEGORIES_API = '/api/categories';
const BATCH_API = '/api/posts/batch';

let categoriesState = [];
let categoriesHash = '';
let catBusy = false;

let ctx = {
  getPosts: () => [],
  getSelection: () => new Set(),
  getCurrentSlug: () => null,
  isPostDirty: () => false,
  loadPosts: async () => {},
  selectPost: async () => {},
  renderList: () => {},
  updateBatchBar: () => {},
  refreshSyncStatus: async () => null,
  onCategoriesLoaded: () => {},
};

export function initCategories(options = {}) {
  ctx = { ...ctx, ...options };
}

export function getCategories() {
  return categoriesState.slice();
}

export async function loadCategories({ silent = false } = {}) {
  try {
    const res = await apiFetch(CATEGORIES_API);
    const data = await res.json();
    if (!res.ok || data.error) {
      if (!silent) toast(data.error || '加载文章分类失败');
      return categoriesState;
    }
    categoriesState = Array.isArray(data.categories) ? data.categories : [];
    categoriesHash = data.contentHash || '';
    ctx.onCategoriesLoaded?.(categoriesState);
    return categoriesState;
  } catch (err) {
    if (!silent) toast('加载文章分类失败: ' + err.message);
    return categoriesState;
  }
}

export function renderPostCategoryPills(selected = []) {
  const host = $('#fPostCategories');
  if (!host) return;
  const active = new Set((Array.isArray(selected) ? selected : []).map((s) => String(s || '').trim()).filter(Boolean));
  // 若文章含暂未录入 categories.json 的历史分类，也临时展示供取消/保留
  const knownNames = new Set(categoriesState.map((c) => c.name));
  const extraNames = [...active].filter((name) => !knownNames.has(name));
  const items = [
    ...categoriesState,
    ...extraNames.map((name, idx) => ({ id: `extra-${idx}`, name, color: '#9a9690', orphan: true })),
  ];
  if (!items.length) {
    host.innerHTML = '<span class="field-hint">暂无可用分类，点击右侧「⚙ 管理分类」创建。</span>';
    return;
  }
  host.innerHTML = items.map((c) => `
    <label class="cat-check-pill${active.has(c.name) ? ' is-checked' : ''}">
      <input type="checkbox" value="${escAttr(c.name)}" ${active.has(c.name) ? 'checked' : ''} />
      <i class="cat-dot" style="background:${escAttr(c.color || '#ff5a1a')}"></i>
      <span>${esc(c.name)}</span>
      ${c.orphan ? '<em style="font-size:9px;opacity:.7">(未入表)</em>' : ''}
    </label>
  `).join('');
}

export function readPostCategorySelection() {
  const host = $('#fPostCategories');
  if (!host) return [];
  return [...host.querySelectorAll('input[type="checkbox"]:checked')]
    .map((el) => el.value.trim())
    .filter(Boolean);
}

export function applyPostCategorySelection(categories = []) {
  renderPostCategoryPills(categories);
}

function renderCategoryManagerBody() {
  const listEl = $('#catManagerList');
  if (!listEl) return;
  const posts = ctx.getPosts() || [];
  const counts = new Map();
  for (const p of posts) {
    for (const c of (p.categories || [])) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  if (!categoriesState.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:18px">暂无大类分类，可在下方添加第一个。</div>';
    return;
  }
  listEl.innerHTML = categoriesState.map((c) => {
    const count = counts.get(c.name) || 0;
    return `
      <div class="cat-mgr-row" data-cat-id="${escAttr(c.id)}">
        <input class="cm-color" type="color" value="${escAttr(c.color || '#ff5a1a')}" title="分类色标" />
        <input class="cm-name" type="text" value="${escAttr(c.name)}" placeholder="分类名称" style="flex:1.1" />
        <input class="cm-slug" type="text" value="${escAttr(c.slug || c.id)}" placeholder="slug" style="width:110px" />
        <input class="cm-order" type="number" value="${Number(c.order) || 1}" title="排序" style="width:58px" />
        <input class="cm-desc" type="text" value="${escAttr(c.description || '')}" placeholder="简介（可选）" style="flex:1.3" />
        <span class="badge" title="关联文章数">${count} 篇</span>
        <button class="btn small primary" type="button" data-cat-save="${escAttr(c.id)}">保存</button>
        <button class="btn small danger" type="button" data-cat-del="${escAttr(c.id)}" data-cat-name="${escAttr(c.name)}" data-cat-count="${count}">删除</button>
      </div>`;
  }).join('');
}

export async function openCategoryManagerModal() {
  const modal = $('#categoryManagerModal');
  if (!modal) return;
  await loadCategories({ silent: true });
  renderCategoryManagerBody();
  openModal(modal);
}

function renderBatchCategoryChoices(selectedSet = new Set()) {
  const box = $('#batchCatCheckList');
  if (!box) return;
  if (!categoriesState.length) {
    box.innerHTML = '<span class="field-hint">还没有大类分类，可直接在下方输入框新建。</span>';
    return;
  }
  box.innerHTML = categoriesState.map((c) => `
    <label class="cat-check-pill${selectedSet.has(c.name) ? ' is-checked' : ''}">
      <input type="checkbox" value="${escAttr(c.name)}" ${selectedSet.has(c.name) ? 'checked' : ''} />
      <i class="cat-dot" style="background:${escAttr(c.color || '#ff5a1a')}"></i>
      <span>${esc(c.name)}</span>
    </label>
  `).join('');
}

export async function openBatchCategoryModal() {
  const slugs = [...(ctx.getSelection()?.() || [])];
  if (!slugs.length) {
    toast('请先勾选至少一篇文章');
    return;
  }
  const modal = $('#batchCategoryModal');
  if (!modal) return;
  await loadCategories({ silent: true });
  const hint = $('#batchCatSummary');
  if (hint) hint.textContent = `已选择 ${slugs.length} 篇文章，勾选要操作的大类分类：`;
  const opRadio = modal.querySelector('input[name="batchCatOp"][value="add-categories"]');
  if (opRadio) opRadio.checked = true;
  // 预填交集分类仅用于参考；默认空勾选更安全
  renderBatchCategoryChoices(new Set());
  const quickInput = $('#fQuickNewCategory');
  if (quickInput) quickInput.value = '';
  openModal(modal);
}

async function reloadPostsAndActive() {
  await ctx.loadPosts();
  const cur = ctx.getCurrentSlug();
  if (cur && !ctx.isPostDirty()) {
    await ctx.selectPost(cur, { skipLeaveGuard: true });
  } else {
    const selected = readPostCategorySelection();
    renderPostCategoryPills(selected);
  }
  ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
}

export function bindCategoryModals() {
  const mgr = $('#categoryManagerModal');
  if (mgr && mgr.dataset.bound !== '1') {
    mgr.dataset.bound = '1';
    $('#btnCatMgrClose')?.addEventListener('click', () => closeModal(mgr));
    mgr.addEventListener('click', (e) => { if (e.target === mgr) closeModal(mgr); });

    $('#btnCatCreate')?.addEventListener('click', async () => {
      if (catBusy) return;
      const name = $('#fNewCatName')?.value?.trim() || '';
      const slug = $('#fNewCatSlug')?.value?.trim() || '';
      const color = $('#fNewCatColor')?.value || '#ff5a1a';
      const desc = $('#fNewCatDesc')?.value?.trim() || '';
      if (!name) { toast('请输入分类名称'); return; }
      catBusy = true;
      try {
        const res = await apiFetch(CATEGORIES_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, slug, color, description: desc, expectedHash: categoriesHash }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '新建分类失败'); return; }
        categoriesState = data.categories || categoriesState;
        categoriesHash = data.contentHash || categoriesHash;
        if ($('#fNewCatName')) $('#fNewCatName').value = '';
        if ($('#fNewCatSlug')) $('#fNewCatSlug').value = '';
        if ($('#fNewCatDesc')) $('#fNewCatDesc').value = '';
        ctx.onCategoriesLoaded?.(categoriesState);
        renderCategoryManagerBody();
        const curSel = readPostCategorySelection();
        renderPostCategoryPills(curSel);
        ctx.refreshSyncStatus?.({ silent: true }).catch?.(() => {});
        toast(`已创建分类「${name}」`);
      } catch (err) { toast('新建分类失败: ' + err.message); }
      finally { catBusy = false; }
    });

    $('#catManagerList')?.addEventListener('click', async (e) => {
      if (catBusy) return;
      const saveBtn = e.target.closest('[data-cat-save]');
      if (saveBtn) {
        const row = saveBtn.closest('.cat-mgr-row');
        const id = saveBtn.dataset.catSave;
        const name = row.querySelector('.cm-name')?.value?.trim() || '';
        const slug = row.querySelector('.cm-slug')?.value?.trim() || '';
        const color = row.querySelector('.cm-color')?.value || '#ff5a1a';
        const order = Number(row.querySelector('.cm-order')?.value || 1);
        const description = row.querySelector('.cm-desc')?.value?.trim() || '';
        if (!name) { toast('分类名称不能为空'); return; }
        catBusy = true;
        try {
          const res = await apiFetch(`${CATEGORIES_API}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, color, order, description, expectedHash: categoriesHash }),
          });
          const data = await res.json();
          if (!res.ok || data.error) { toast(data.error || '保存分类失败'); return; }
          categoriesState = data.categories || categoriesState;
          categoriesHash = data.contentHash || categoriesHash;
          ctx.onCategoriesLoaded?.(categoriesState);
          renderCategoryManagerBody();
          await reloadPostsAndActive();
          toast(data.updatedPosts ? `已保存分类并级联更新 ${data.updatedPosts} 篇文章` : '分类已更新');
        } catch (err) { toast('保存分类失败: ' + err.message); }
        finally { catBusy = false; }
        return;
      }

      const delBtn = e.target.closest('[data-cat-del]');
      if (delBtn) {
        const id = delBtn.dataset.catDel;
        const name = delBtn.dataset.catName;
        const count = Number(delBtn.dataset.catCount || 0);
        const msg = count > 0
          ? `确定删除分类「${name}」？将同时从 ${count} 篇文章 frontmatter 中移除该分类，此操作可从文章修订历史恢复。`
          : `确定删除分类「${name}」？`;
        if (!confirm(msg)) return;
        catBusy = true;
        try {
          const res = await apiFetch(`${CATEGORIES_API}/${encodeURIComponent(id)}?expectedHash=${encodeURIComponent(categoriesHash)}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (!res.ok || data.error) { toast(data.error || '删除分类失败'); return; }
          categoriesState = data.categories || categoriesState;
          categoriesHash = data.contentHash || categoriesHash;
          ctx.onCategoriesLoaded?.(categoriesState);
          renderCategoryManagerBody();
          await reloadPostsAndActive();
          toast(data.updatedPosts ? `已删除「${name}」并清理 ${data.updatedPosts} 篇文章` : `已删除「${name}」`);
        } catch (err) { toast('删除分类失败: ' + err.message); }
        finally { catBusy = false; }
      }
    });
  }

  const batchModal = $('#batchCategoryModal');
  if (batchModal && batchModal.dataset.bound !== '1') {
    batchModal.dataset.bound = '1';
    $('#btnBatchCatCancel')?.addEventListener('click', () => closeModal(batchModal));
    batchModal.addEventListener('click', (e) => { if (e.target === batchModal) closeModal(batchModal); });

    $('#batchCatCheckList')?.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (cb) cb.closest('.cat-check-pill')?.classList.toggle('is-checked', cb.checked);
    });

    $('#btnQuickAddCat')?.addEventListener('click', async () => {
      const name = $('#fQuickNewCategory')?.value?.trim() || '';
      if (!name) { toast('请输入新分类名称'); return; }
      try {
        const res = await apiFetch(CATEGORIES_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, expectedHash: categoriesHash }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '创建失败'); return; }
        categoriesState = data.categories || categoriesState;
        categoriesHash = data.contentHash || categoriesHash;
        if ($('#fQuickNewCategory')) $('#fQuickNewCategory').value = '';
        ctx.onCategoriesLoaded?.(categoriesState);
        const curChecked = new Set(
          [...$('#batchCatCheckList').querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value),
        );
        curChecked.add(data.item?.name || name);
        renderBatchCategoryChoices(curChecked);
        toast(`已创建并勾选「${data.item?.name || name}」`);
      } catch (err) { toast('创建分类失败: ' + err.message); }
    });

    $('#btnBatchCatApply')?.addEventListener('click', async () => {
      if (catBusy) return;
      const slugs = [...(ctx.getSelection()?.() || [])];
      if (!slugs.length) { toast('没有选中的文章'); return; }
      const action = batchModal.querySelector('input[name="batchCatOp"]:checked')?.value || 'add-categories';
      const categories = [...$('#batchCatCheckList').querySelectorAll('input[type="checkbox"]:checked')]
        .map((i) => i.value.trim())
        .filter(Boolean);
      if ((action === 'add-categories' || action === 'remove-categories') && !categories.length) {
        toast('请至少勾选一个分类');
        return;
      }
      if (action === 'set-categories' && !categories.length && !confirm('未勾选任何分类，将清空选中文章的大类（设为未归类），继续？')) {
        return;
      }
      catBusy = true;
      const btn = $('#btnBatchCatApply');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 处理中…'; }
      try {
        const res = await apiFetch(BATCH_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, slugs, categories }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { toast(data.error || '批量归类失败'); return; }
        closeModal(batchModal);
        ctx.getSelection()?.clear();
        ctx.updateBatchBar?.();
        await reloadPostsAndActive();
        toast(`批量归类完成：成功 ${data.okCount} 篇${data.failCount ? `，失败 ${data.failCount} 篇` : ''}`);
      } catch (err) { toast('批量归类失败: ' + err.message); }
      finally {
        catBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = '应用归类'; }
      }
    });
  }
}
