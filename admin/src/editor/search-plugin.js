/**
 * ProseMirror 查找与替换扩展（Ctrl+F / Ctrl+H）：
 * 基于 DecorationSet 高亮全部匹配项，支持大小写开关、上一个/下一个定位、单项替换与全部替换。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const searchPluginKey = new PluginKey('acrSearchReplace');

function findMatches(doc, query, caseSensitive) {
  const results = [];
  if (!query) return results;
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = caseSensitive ? node.text : node.text.toLowerCase();
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      results.push({ from: pos + idx, to: pos + idx + query.length });
      idx += Math.max(1, query.length);
    }
  });
  return results;
}

function buildDecorations(doc, matches, activeIndex) {
  if (!matches.length) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? 'acr-search-hit acr-search-hit--active' : 'acr-search-hit',
    }),
  );
  return DecorationSet.create(doc, decos);
}

export const SearchAndReplace = Extension.create({
  name: 'searchAndReplace',

  addStorage() {
    return {
      query: '',
      replaceWith: '',
      caseSensitive: false,
      activeIndex: 0,
      matches: [],
    };
  },

  addCommands() {
    const syncOnTr = (editor, tr, { selectActive = false } = {}) => {
      const s = editor.storage.searchAndReplace;
      s.matches = findMatches(tr.doc, s.query, s.caseSensitive);
      if (s.matches.length === 0) s.activeIndex = 0;
      else if (s.activeIndex >= s.matches.length) s.activeIndex = 0;
      else if (s.activeIndex < 0) s.activeIndex = s.matches.length - 1;

      tr.setMeta(searchPluginKey, { updated: true });
      if (selectActive && s.matches.length > 0) {
        const cur = s.matches[s.activeIndex];
        tr.setSelection(TextSelection.create(tr.doc, cur.from, cur.to));
        tr.scrollIntoView();
      }
      return true;
    };

    return {
      setSearchTerm: (query, { caseSensitive } = {}) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        s.query = String(query || '');
        if (typeof caseSensitive === 'boolean') s.caseSensitive = caseSensitive;
        s.activeIndex = 0;
        syncOnTr(editor, tr, { selectActive: false });
        if (dispatch) dispatch(tr);
        return true;
      },
      setReplaceTerm: (value) => ({ editor }) => {
        editor.storage.searchAndReplace.replaceWith = String(value ?? '');
        return true;
      },
      findNext: () => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        s.matches = findMatches(tr.doc, s.query, s.caseSensitive);
        if (!s.matches.length) return false;
        s.activeIndex = (s.activeIndex + 1) % s.matches.length;
        syncOnTr(editor, tr, { selectActive: true });
        if (dispatch) dispatch(tr);
        return true;
      },
      findPrev: () => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        s.matches = findMatches(tr.doc, s.query, s.caseSensitive);
        if (!s.matches.length) return false;
        s.activeIndex = (s.activeIndex - 1 + s.matches.length) % s.matches.length;
        syncOnTr(editor, tr, { selectActive: true });
        if (dispatch) dispatch(tr);
        return true;
      },
      replaceCurrent: () => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        s.matches = findMatches(tr.doc, s.query, s.caseSensitive);
        if (!s.matches.length) return false;
        const cur = s.matches[s.activeIndex] || s.matches[0];
        tr.insertText(s.replaceWith, cur.from, cur.to);
        syncOnTr(editor, tr, { selectActive: true });
        if (dispatch) dispatch(tr);
        return true;
      },
      replaceAll: () => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        const matches = findMatches(tr.doc, s.query, s.caseSensitive);
        if (!matches.length) return false;
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          tr.insertText(s.replaceWith, matches[i].from, matches[i].to);
        }
        s.activeIndex = 0;
        syncOnTr(editor, tr, { selectActive: false });
        if (dispatch) dispatch(tr);
        return true;
      },
      clearSearch: () => ({ editor, tr, dispatch }) => {
        const s = editor.storage.searchAndReplace;
        s.query = '';
        s.matches = [];
        s.activeIndex = 0;
        syncOnTr(editor, tr, { selectActive: false });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old, _oldState, newState) => {
            const s = ext.storage;
            if (!s.query) return DecorationSet.empty;
            if (tr.docChanged || tr.getMeta(searchPluginKey)) {
              s.matches = findMatches(newState.doc, s.query, s.caseSensitive);
              if (s.activeIndex >= s.matches.length) s.activeIndex = 0;
              return buildDecorations(newState.doc, s.matches, s.activeIndex);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
