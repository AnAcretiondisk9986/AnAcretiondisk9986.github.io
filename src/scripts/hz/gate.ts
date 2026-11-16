/**
 * HORIZON · gate.ts
 * 气闸门禁逻辑：authorized（站长网名 + sessionStorage）与 admin（SHA-256 口令 + localStorage）。
 */

const bound = new WeakSet<HTMLElement>();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function initGate(root: HTMLElement) {
  if (bound.has(root)) return;
  bound.add(root);

  const mode = root.dataset.gateMode === 'admin' ? 'admin' : 'authorized';
  const id = root.dataset.gateId || 'article';
  const expectedHash = root.dataset.gateHash || '';
  const box = root.querySelector<HTMLElement>('[data-gate-box]');
  const form = root.querySelector<HTMLFormElement>('[data-gate-form]');
  const err = root.querySelector<HTMLElement>('[data-gate-err]');
  const tpl = root.querySelector<HTMLTemplateElement>('template[data-gate-body]');
  if (!box || !form || !err || !tpl) return;

  const unlock = () => {
    const frag = tpl.content.cloneNode(true);
    box.replaceWith(frag);
    document.dispatchEvent(new CustomEvent('hz:gate-unlocked', { detail: { mode, id } }));
    document.dispatchEvent(new CustomEvent('acr:private-revealed'));
  };

  if (mode === 'authorized') {
    const key = `acr-authorized:${id}`;
    try {
      if (sessionStorage.getItem(key) === '1') {
        unlock();
        return;
      }
    } catch {
      /* ignore */
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = String(new FormData(form).get('credential') || '')
        .trim()
        .toLowerCase();
      if (val === 'anacretiondisk' || val === 'acretiondisk') {
        try {
          sessionStorage.setItem(key, '1');
        } catch {
          /* ignore */
        }
        unlock();
      } else {
        err.textContent = 'SIGNAL REJECTED · 网名不正确，请再试一次。';
      }
    });
  } else {
    const key = 'acr-private-admin-unlocked';
    try {
      if (expectedHash && localStorage.getItem(key) === expectedHash) {
        unlock();
        return;
      }
    } catch {
      /* ignore */
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = String(new FormData(form).get('credential') || '');
      if (!pwd) return;
      try {
        const hash = await sha256Hex(pwd);
        if (hash === expectedHash) {
          try {
            localStorage.setItem(key, expectedHash);
          } catch {
            /* ignore */
          }
          unlock();
        } else {
          err.textContent = 'ACCESS DENIED · 密码不正确。';
        }
      } catch {
        err.textContent = '当前环境不支持加密摘要校验，请在 HTTPS 或 localhost 下打开。';
      }
    });
  }
}

document.querySelectorAll<HTMLElement>('[data-hz-gate]').forEach(initGate);
