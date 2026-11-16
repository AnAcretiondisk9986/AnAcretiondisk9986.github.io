/**
 * ACR·BLOG 桌面版（Electron 主进程）
 *
 * 打包后的成品说明：
 * - 应用只带界面外壳；博客服务端（admin-server.mjs）在应用进程内启动，路径来自本地配置。
 * - 仓库位置首次启动时选择，之后保存在用户数据目录，菜单里可更换。
 * - 因此不需要外部 node、不需要 bat、不需要浏览器，双击应用即可编辑博客。
 *
 * 稳定性设计（都是被"双击没反应"逼出来的）：
 * 1. 每一阶段都写日志（desktop/log.mjs → %APPDATA%\ACR-BLOG\logs\main.log）。
 * 2. 窗口先显示（本地 splash 页），再启动服务；服务慢或失败也能看到界面和原因。
 * 3. 启动标记：上次没走到"窗口显示"就退出，则本次自动进入安全模式（关 GPU/关沙箱）。
 * 4. 任何异常都落到错误页/错误框，绝不静默退出。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log, logError, logFilePath, tailLog } from './log.mjs';
import { pickPort, waitForHttp } from './server-control.mjs';
import { ensureToken, isBlogRepo, loadConfig, pickDefaultRepo, saveConfig, defaultImageRepo, serverEnv } from './config.mjs';

const APP_NAME = 'ACR-BLOG';
const DISPLAY_NAME = 'ACR·BLOG';

log('');
log('==== 启动 ====');
log('版本:', process.versions.electron ? `Electron ${process.versions.electron}` : '非 Electron 运行时');
log('exe:', process.execPath);
log('cwd:', process.cwd());
log('argv:', JSON.stringify(process.argv.slice(1)));
log('模式:', process.defaultApp ? '开发（electron .）' : '打包');
log('日志文件:', logFilePath() || '(所有候选目录都不可写)');

/** 用户数据/状态目录（与 Electron 的 userData 同源，但对早期阶段也可用） */
function stateDir() {
  const base = process.env.APPDATA || process.env.LOCALAPPDATA || process.env.TEMP || process.env.TMP || '.';
  return join(base, APP_NAME);
}

function markerPath() {
  return join(stateDir(), 'booting.marker');
}

/** 上次启动是否死在半路（用来决定本次是否进安全模式） */
function readAndClearMarker() {
  const file = markerPath();
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8').trim() || '上次启动未完成';
  } catch {
    return '上次启动未完成';
  } finally {
    try { rmSync(file, { force: true }); } catch { /* 忽略 */ }
  }
}

function writeMarker() {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(markerPath(), new Date().toISOString(), 'utf8');
  } catch (err) {
    logError('写启动标记失败', err);
  }
}

function clearMarker() {
  try { rmSync(markerPath(), { force: true }); } catch { /* 忽略 */ }
}

if (!process.versions.electron) {
  log('不是 Electron 运行时：可能是 ELECTRON_RUN_AS_NODE 等环境变量让 electron.exe 退化成 node。');
  process.exit(1);
}

// 上次异常退出 → 本次安全模式：禁用 GPU 与沙箱，绕开显卡/安全软件导致的启动失败
const safeMode = readAndClearMarker() !== null;
log('安全模式:', safeMode ? '开启（上次未正常启动）' : '关闭');

const { app, BrowserWindow, Menu, dialog, shell } = await import('electron');
log('electron 模块已加载');

if (safeMode) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
  log('已附加安全模式开关: disable-gpu / no-sandbox');
}

writeMarker();

let win = null;
let serverUrl = '';
let config = {};
let fatalShown = false;

app.setName(APP_NAME);

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  showFatal('主进程未捕获异常', err);
});
process.on('unhandledRejection', (err) => {
  logError('unhandledRejection', err);
});

function userDataDir() {
  const dir = app.getPath('userData');
  log('userData:', dir);
  return dir;
}

function persist(patch) {
  config = { ...config, ...patch };
  saveConfig(userDataDir(), config);
}

/** 让 服务端 读到正确的仓库/数据路径 */
function applyRepoEnv(repoPath, imageRepoPath) {
  Object.assign(process.env, serverEnv({
    repoPath,
    imageRepoPath,
    token: config.token,
    port: process.env.PORT || 4322,
  }));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 错误页：直接渲染在窗口里，用户能看到原因，也能复制日志 */
function errorPage(title, detail) {
  const logs = tailLog(25);
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
 html,body{height:100%;margin:0;background:#f6f5f2;color:#2c2a26;font-family:"Microsoft YaHei UI",system-ui,sans-serif}
 .wrap{max-width:820px;margin:0 auto;padding:40px 32px}
 h1{font-size:18px;margin:0 0 14px}
 .card{background:#fff;border:1px solid #e6e1d6;border-radius:10px;padding:16px 18px;margin:0 0 16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7}
 .lab{font-size:12px;color:#8b8577;margin:18px 0 6px;letter-spacing:.4px}
 pre{background:#2c2a26;color:#e8e3d8;border-radius:10px;padding:14px 16px;font-size:12px;line-height:1.6;overflow:auto;max-height:320px;white-space:pre-wrap}
 code{font-family:Consolas,monospace}
</style></head><body><div class="wrap">
<h1>${escapeHtml(DISPLAY_NAME)} 启动失败</h1>
<div class="card">${escapeHtml(detail || '未知错误')}</div>
<div class="lab">日志文件</div>
<div class="card"><code>${escapeHtml(logFilePath() || '(不可写)')}</code></div>
<div class="lab">最近日志</div>
<pre>${escapeHtml(logs || '(无)')}</pre>
</div></body></html>`);
}

/** 把失败原因呈现出来：有窗口就用窗口，没窗口就用系统对话框 */
async function showFatal(title, err) {
  if (fatalShown) return;
  fatalShown = true;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  log('显示错误界面:', title, '|', detail);
  try {
    if (win && !win.isDestroyed()) {
      await win.loadURL(errorPage(title, detail));
      win.show();
      return;
    }
  } catch (e) {
    logError('渲染错误页失败', e);
  }
  try {
    dialog.showErrorBox(`${DISPLAY_NAME} 启动失败`, `${title}\n\n${detail}\n\n日志：${logFilePath()}`);
  } catch (e) {
    logError('弹错误框失败', e);
  }
}

/** 选择一个可用的博客仓库目录（首次启动或目录失效时） */
async function chooseRepo(reason) {
  const hint = [
    reason ? `${reason}\n` : '',
    '请选择博客仓库目录（需要包含 admin-server.mjs 与 src/content/blog）。',
    '',
    '如果还没安装依赖，请先在该目录执行：npm install',
  ].join('\n');
  const result = await dialog.showOpenDialog({
    title: '选择博客仓库目录',
    message: hint,
    properties: ['openDirectory'],
    defaultPath: app.getPath('documents'),
  });
  const picked = result.filePaths?.[0];
  if (!picked) return null;
  if (!isBlogRepo(picked)) {
    await dialog.showMessageBox({ type: 'error', message: '该目录不是博客仓库', detail: `缺少 admin-server.mjs 或 src/content/blog：\n${picked}` });
    return null;
  }
  persist({ repoPath: resolve(picked) });
  return resolve(picked);
}

async function bootServer() {
  log('挑选端口…');
  const port = await pickPort(Number(process.env.PORT) || 4322);
  process.env.PORT = String(port);
  log('使用端口:', port);

  const serverEntry = join(config.repoPath, 'admin-server.mjs');
  log('导入服务端:', serverEntry);
  try {
    await import(pathToFileURL(serverEntry).href);
    log('服务端模块已加载');
  } catch (err) {
    logError('导入服务端失败', err);
    throw new Error(`无法启动博客服务：${err?.message || err}\n\n请确认已在仓库目录执行 npm install，且 Node 依赖完整。\n仓库：${config.repoPath}`);
  }

  serverUrl = `http://127.0.0.1:${port}/admin`;
  log('等待服务就绪:', serverUrl);
  try {
    await waitForHttp(serverUrl, { timeoutMs: 30000 });
    log('服务已就绪:', serverUrl);
  } catch (err) {
    logError('等待服务就绪失败', err);
    throw new Error(`博客服务没有在 30 秒内就绪。\n${err?.message || err}\n\n仓库：${config.repoPath}\n` +
      '常见原因：依赖没装（在仓库目录执行 npm install）、端口被占用、或 admin-server.mjs 启动时报错。');
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '重新载入界面', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        { label: '打开线上站点', click: () => shell.openExternal('https://blog.acretiondisk.top') },
        { type: 'separator' },
        {
          label: '更换博客目录…',
          click: async () => {
            const picked = await chooseRepo('更换后需要重新启动应用生效。');
            if (picked) {
              const relaunch = await dialog.showMessageBox({
                type: 'question',
                buttons: ['立即重启', '稍后手动重启'],
                defaultId: 0,
                message: '目录已保存，是否立即重启应用？',
              });
              if (relaunch.response === 0) {
                app.relaunch();
                app.exit(0);
              }
            }
          },
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '打开博客目录', click: () => shell.openPath(config.repoPath || app.getPath('documents')) },
        { label: '打开日志文件夹', click: () => shell.openPath(join(stateDir(), 'logs')) },
        {
          label: '关于',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: '关于',
            message: `${DISPLAY_NAME} 桌面版`,
            detail: [
              `版本：${app.getVersion()}`,
              `博客仓库：${config.repoPath}`,
              `图片仓库：${config.imageRepoPath || defaultImageRepo(config.repoPath)}`,
              `服务地址：${serverUrl || '未启动'}`,
              `Electron：${process.versions.electron}`,
              `安全模式：${safeMode ? '开' : '关'}`,
              `日志：${logFilePath() || '不可写'}`,
              '',
              '界面与数据格式同管理面板一致，可混用命令行与终端版本。',
            ].join('\n'),
          }),
        },
      ],
    },
  ]));
  log('菜单已就绪');
}

async function createWindow() {
  if (win) return win;
  const iconPath = join(app.getAppPath(), 'desktop', 'icon.ico');
  log('创建窗口…', existsSync(iconPath) ? '' : '(图标缺失)');
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    title: `${DISPLAY_NAME} 桌面版`,
    backgroundColor: '#f6f5f2',
    show: false,
    autoHideMenuBar: false,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });

  let shown = false;
  const reveal = (why) => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    try {
      win.show();
      win.focus();
      log('窗口已显示（' + why + '）');
    } catch (err) {
      logError('show() 失败', err);
    }
    clearMarker();
  };

  win.once('ready-to-show', () => reveal('ready-to-show'));
  // 兜底：即使 ready-to-show 没触发，也必须让用户看到窗口，而不是"没反应"
  setTimeout(() => reveal('超时兜底'), 8000);

  win.on('closed', () => { win = null; });
  win.on('unresponsive', () => log('窗口无响应'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('页面加载失败:', code, desc, url));
  win.webContents.on('render-process-gone', (_e, details) => log('渲染进程结束:', JSON.stringify(details)));
  win.webContents.on('unresponsive', () => log('渲染页无响应'));
  win.webContents.on('console-message', (...args) => {
    const d = args[1];
    if (d && typeof d === 'object' && 'message' in d) {
      log(`renderer[${d.level}]`, d.message, d.sourceId ? `(${d.sourceId}:${d.lineNumber})` : '');
    } else {
      log('renderer:', args.slice(1).join(' '));
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (serverUrl && !target.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  const splash = join(app.getAppPath(), 'desktop', 'splash.html');
  log('加载启动页:', splash);
  try {
    await win.loadFile(splash);
    log('启动页已加载');
  } catch (err) {
    logError('加载启动页失败（继续，直接等服务）', err);
  }
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log('已有实例在运行，本实例退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('收到第二个实例请求，聚焦窗口');
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

app.on('child-process-gone', (_e, details) => log('子进程结束:', JSON.stringify(details)));

app.whenReady().then(async () => {
  log('app ready');
  try {
    buildMenu();
  } catch (err) {
    logError('构建菜单失败（不致命）', err);
  }

  try {
    config = loadConfig(userDataDir());
    log('已读配置:', JSON.stringify({ ...config, token: config.token ? '(已保存)' : '(无)' }));
    config.token = ensureToken(config.token);
    persist({ token: config.token });

    let repoPath = config.repoPath;
    if (!isBlogRepo(repoPath)) {
      log('配置里的仓库不可用:', repoPath || '(空)');
      const fallback = pickDefaultRepo(app.getPath('documents'));
      log('默认候选结果:', fallback || '(无)');
      repoPath = fallback || await chooseRepo(config.repoPath ? '上次使用的博客目录已不可用。' : '');
    }
    if (!repoPath) {
      log('用户没有选择仓库，退出');
      return;
    }
    persist({ repoPath });
    config.imageRepoPath = config.imageRepoPath || defaultImageRepo(repoPath);
    persist({ imageRepoPath: config.imageRepoPath });
    log('仓库:', repoPath);
    log('图片仓库:', config.imageRepoPath);

    applyRepoEnv(repoPath, config.imageRepoPath);
    await createWindow();          // 先给用户一个窗口，避免"什么都没发生"
    await bootServer();
    log('加载管理界面:', serverUrl);
    await win.loadURL(serverUrl);
    log('管理界面已加载');
  } catch (err) {
    logError('启动流程失败', err);
    await showFatal('启动流程失败', err);
  }
}).catch((err) => {
  logError('whenReady 流程异常', err);
  showFatal('whenReady 流程异常', err);
});

app.on('activate', () => { if (!win && serverUrl) createWindow(); });
app.on('window-all-closed', () => { log('所有窗口已关闭，退出'); app.quit(); });
