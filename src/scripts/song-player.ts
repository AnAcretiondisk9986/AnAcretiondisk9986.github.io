/**
 * 文章内嵌音乐播放条
 *
 * 在 Markdown 正文直接写占位块（satteri 原样保留）：
 *
 *   <div class="song-player" data-src="音频直链或网易云歌曲页链接" data-title="歌名" data-artist="歌手" data-cover="封面图URL"><a href="…">♪ 播放音频</a></div>
 *
 * - data-src 必填（http(s)）；支持两类来源：
 *   1) 音频文件直链（mp3 / flac / ogg / wav / m4a 等，如 jsDelivr 上的自托管文件）；
 *   2) 网易云歌曲页链接（music.163.com/song?id=…）——自动映射到官方外链直链端点播放；
 * - data-title / data-artist / data-cover 可选；占位块内的文本是无 JS 时的降级内容；
 * - 脚本把占位块增强为播放条：封面 / 歌名 / 歌手 / 播放暂停 / 进度拖动 / 时间 / 音量；
 * - 同页多个播放条共享一个 Audio 实例，同一时间只播放一个。
 *
 * 由文章页 <script> 引入，astro:page-load 驱动，每次 View Transitions 导航后重新增强。
 */

interface SongConfig {
  src: string;
  title: string;
  artist: string;
  cover: string;
  /** 来源是网易云歌曲页链接（经官方外链直链播放） */
  netease: boolean;
}

const NOTE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

let sharedAudio: HTMLAudioElement | null = null;
let activeHost: HTMLElement | null = null;

declare global {
  interface HTMLAudioElement {
    /** 进度条拖动中：暂停 timeupdate 回写 */
    dragging?: boolean;
  }
}

/** 网易云歌曲页链接 → 官方外链直链（低码率 mp3）；无版权 / 下架歌曲该端点 404 */
function resolveAudioSrc(src: string): string {
  const m = src.match(/music\.163\.com\/song[?/]id=(\d+)/i);
  if (m) return `https://music.163.com/song/media/outer/url?id=${m[1]}.mp3`;
  return src;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function srcToTitle(src: string): string {
  const clean = src.split(/[?#]/)[0] ?? src;
  const name = clean.split('/').pop() ?? clean;
  let base = name.replace(/\.[a-z0-9]+$/i, '');
  try {
    base = decodeURIComponent(base); // 中文/空格文件名以 %XX 编码时还原
  } catch {
    /* 非合法编码则保留原样 */
  }
  return base || '未命名曲目';
}

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'none';
    sharedAudio.volume = 1;
    sharedAudio.addEventListener('timeupdate', onTimeUpdate, { passive: true });
    sharedAudio.addEventListener('loadedmetadata', onTimeUpdate, { passive: true });
    sharedAudio.addEventListener('ended', onEnded);
    sharedAudio.addEventListener('pause', onPause);
    sharedAudio.addEventListener('error', onError);
  }
  return sharedAudio;
}

function setPlaying(host: HTMLElement | null, playing: boolean): void {
  if (!host) return;
  host.classList.toggle('is-playing', playing);
  const btn = host.querySelector<HTMLButtonElement>('.song-player__toggle');
  if (btn) {
    btn.textContent = playing ? '⏸' : '▶';
    btn.setAttribute('aria-label', playing ? '暂停' : '播放');
  }
}

function syncProgress(host: HTMLElement, audio: HTMLAudioElement): void {
  const range = host.querySelector<HTMLInputElement>('.song-player__progress');
  const current = host.querySelector<HTMLElement>('.song-player__current');
  const duration = host.querySelector<HTMLElement>('.song-player__duration');
  if (!audio.dragging && range && Number.isFinite(audio.duration) && audio.duration > 0) {
    range.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  }
  if (current) current.textContent = formatTime(audio.currentTime);
  if (duration && Number.isFinite(audio.duration)) {
    duration.textContent = formatTime(audio.duration);
  }
}

function showError(host: HTMLElement, netease: boolean): void {
  if (host.querySelector('.song-player__err')) return;
  const err = document.createElement('span');
  err.className = 'song-player__err';
  err.textContent = netease
    ? '⚠ 无法加载音频：该网易云歌曲可能已下架 / 无版权，不支持外链播放'
    : '⚠ 无法加载音频：请确认 data-src 是音频文件直链（mp3 / flac 等），而非网页链接';
  host.appendChild(err);
}

function onTimeUpdate(): void {
  if (activeHost && sharedAudio) syncProgress(activeHost, sharedAudio);
}

function onEnded(): void {
  if (sharedAudio) sharedAudio.dragging = false;
  if (activeHost && sharedAudio) {
    setPlaying(activeHost, false);
    syncProgress(activeHost, sharedAudio);
  }
}

function onPause(): void {
  if (activeHost) setPlaying(activeHost, false);
}

function onError(): void {
  if (!activeHost) return;
  const netease = activeHost.dataset.netease === 'true';
  showError(activeHost, netease);
  setPlaying(activeHost, false);
}

function makeCover(cover: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'song-player__cover';
  if (cover) {
    const img = document.createElement('img');
    img.src = cover;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      el.innerHTML = NOTE_SVG;
    });
    el.appendChild(img);
  } else {
    el.innerHTML = NOTE_SVG;
  }
  return el;
}

function makeVolume(host: HTMLElement, audio: () => HTMLAudioElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'song-player__volume';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'song-player__volume-toggle';
  btn.textContent = '🔊';
  btn.setAttribute('aria-label', '静音');
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'song-player__volume-slider';
  range.min = '0';
  range.max = '100';
  range.value = '100';
  range.setAttribute('aria-label', '音量');
  let lastVolume = 1;
  const syncIcon = (): void => {
    const a = audio();
    btn.textContent = a.muted || a.volume === 0 ? '🔇' : '🔊';
  };
  btn.addEventListener('click', () => {
    const a = audio();
    if (a.muted || a.volume === 0) {
      a.muted = false;
      a.volume = lastVolume > 0 ? lastVolume : 1;
      range.value = String(Math.round(a.volume * 100));
    } else {
      lastVolume = a.volume || 1;
      a.muted = true;
    }
    syncIcon();
  });
  range.addEventListener('input', () => {
    const a = audio();
    const v = Number(range.value) / 100;
    if (v > 0) lastVolume = v;
    a.muted = false;
    a.volume = v;
    syncIcon();
  });
  box.append(btn, range);
  return box;
}

function enhance(host: HTMLElement, cfg: SongConfig): void {
  // 清空无 JS 降级内容，构建播放条 UI
  host.textContent = '';
  host.classList.add('is-enhanced');
  if (cfg.netease) host.dataset.netease = 'true';

  const cover = makeCover(cfg.cover);
  const info = document.createElement('div');
  info.className = 'song-player__info';
  const title = document.createElement('div');
  title.className = 'song-player__title';
  title.textContent = cfg.title;
  const artist = document.createElement('div');
  artist.className = 'song-player__artist';
  artist.textContent = cfg.artist;
  info.append(title, artist);

  const controls = document.createElement('div');
  controls.className = 'song-player__controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'song-player__toggle';
  toggle.textContent = '▶';
  toggle.setAttribute('aria-label', `播放 ${cfg.title}`);
  const track = document.createElement('div');
  track.className = 'song-player__track';
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'song-player__progress';
  range.min = '0';
  range.max = '1000';
  range.value = '0';
  range.setAttribute('aria-label', '播放进度');
  const time = document.createElement('div');
  time.className = 'song-player__time';
  const current = document.createElement('span');
  current.className = 'song-player__current';
  current.textContent = '0:00';
  const sep = document.createElement('span');
  sep.className = 'song-player__sep';
  sep.textContent = ' / ';
  const duration = document.createElement('span');
  duration.className = 'song-player__duration';
  duration.textContent = '0:00';
  time.append(current, sep, duration);
  track.append(range, time);
  controls.append(toggle, track);
  controls.append(makeVolume(host, getAudio));

  host.append(cover, info, controls);

  const togglePlay = (): void => {
    const audio = getAudio();
    if (activeHost === host && !audio.paused) {
      audio.pause();
      setPlaying(host, false);
      return;
    }
    if (activeHost !== host) {
      // 切歌：停掉上一个播放条，重建音频源
      if (activeHost) setPlaying(activeHost, false);
      audio.src = resolveAudioSrc(cfg.src);
      activeHost = host;
    }
    audio.play().then(() => {
      host.querySelector('.song-player__err')?.remove(); // 重播成功后清除上次的错误提示
      setPlaying(host, true);
    }).catch(() => {
      showError(host, cfg.netease);
      setPlaying(host, false);
    });
  };

  toggle.addEventListener('click', togglePlay);

  range.addEventListener('input', () => {
    const audio = getAudio();
    audio.dragging = true;
    const cur = host.querySelector<HTMLElement>('.song-player__current');
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (Number(range.value) / 1000) * audio.duration;
      if (cur) cur.textContent = formatTime(audio.currentTime);
    }
  });
  range.addEventListener('change', () => {
    getAudio().dragging = false;
  });
}

export function initSongPlayers(root: ParentNode = document): void {
  const hosts = root.querySelectorAll<HTMLElement>('.prose .song-player[data-src]');
  hosts.forEach((host) => {
    if (host.classList.contains('is-enhanced')) return;
    const src = host.dataset.src ?? '';
    if (!/^(https?:)?\/\//i.test(src)) return; // 非 http(s) 直链不渲染
    const cfg: SongConfig = {
      src,
      title: host.dataset.title || srcToTitle(src),
      artist: host.dataset.artist || '',
      // 封面与 src 同样限 http(s)，避免请求任意协议 URL
      cover: /^(https?:)?\/\//i.test(host.dataset.cover ?? '') ? (host.dataset.cover as string) : '',
      netease: /music\.163\.com\/song[?/]id=/i.test(src),
    };
    enhance(host, cfg);
  });
}

/** 停止当前播放（View Transitions 离开文章页后调用，避免声音延续到下一页） */
export function stopSongPlayback(): void {
  if (sharedAudio && !sharedAudio.paused) {
    sharedAudio.pause();
    sharedAudio.currentTime = 0;
  }
  if (activeHost) {
    setPlaying(activeHost, false);
    activeHost = null;
  }
}
