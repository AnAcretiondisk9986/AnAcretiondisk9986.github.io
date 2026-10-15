/**
 * jsDelivr 镜像自动降级 + 封面缩略图回退（全站生效）。
 *
 * 背景：站点 294 处图片引用都指向 cdn.jsdelivr.net，而国内访问该域名时常被墙或超时。
 * 原先只有图库页做了「依次切换 fastly / gcore / testingcf 镜像」的处理，
 * 且绑定写在 `astro:page-load` 回调里 —— 每次客户端导航都会再注册一个监听器。
 *
 * 现在改为 BaseLayout 引入的全局脚本：
 *   · 只在模块首次执行时注册一次委托监听，ClientRouter 导航后依然有效；
 *   · 覆盖首页 hero、文章正文图片、卡片封面等所有 <img>；
 *   · 镜像全部失败后，若该图是 480px 缩略图（image/thumb/…），回退到原始封面图，
 *     避免新增文章缺少缩略图时封面留白。
 */

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'testingcf.jsdelivr.net',
];

const nextCdnHost = (host: string) => {
  const i = CDN_HOSTS.indexOf(host);
  return i >= 0 && i < CDN_HOSTS.length - 1 ? CDN_HOSTS[i + 1] : null;
};

/** 已在最终镜像上失败过的图片，避免与回退逻辑互相触发 */
const exhausted = new WeakSet<HTMLImageElement>();

const bindCdnFallback = () => {
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (exhausted.has(img)) return;

    let url: URL;
    try {
      // 用 img.src（当前被要求加载的地址）而不是 currentSrc：
      // currentSrc 在 src 刚变更、新资源尚未加载完成时仍指向旧地址，
      // 会让镜像判断原地踏步（真实弱网下就表现为「重试了但没换镜像」）。
      url = new URL(img.src || img.currentSrc, location.href);
    } catch {
      return; // 非法 URL，忽略
    }

    // 1) 还有下一个 jsDelivr 镜像 → 换主机重试（失败会再次触发 error，自然推进）
    const next = nextCdnHost(url.hostname);
    if (next) {
      url.hostname = next;
      img.src = url.href;
      return;
    }

    // 2) 镜像用尽：若是缩略图，回退到原始封面（由 PostCatalog 写入 data-original-cover）
    const fallback = img.dataset.originalCover;
    if (fallback && img.getAttribute('src') !== fallback) {
      exhausted.add(img);
      img.removeAttribute('data-original-cover');
      img.src = fallback;
    }
  }, true);
};

bindCdnFallback();

export {};
