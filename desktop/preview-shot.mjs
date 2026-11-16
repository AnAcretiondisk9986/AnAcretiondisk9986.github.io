/**
 * 桌面版界面预览：起管理服务 → 用系统 Chrome 打开 /admin → 截图。
 * 用途：在没有图形会话的环境里核对「Electron 窗口会显示什么」。
 * 运行：node desktop/preview-shot.mjs [输出图片路径]
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { freePort, startAdminServer } from './server-control.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || resolve(REPO, 'reports', 'desktop-preview.png'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const port = await freePort();
const server = await startAdminServer({ repoDir: REPO, port, log: () => {} });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
});

try {
  mkdirSync(dirname(OUT), { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(server.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.topbar', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200)); // 等编辑器与列表首屏渲染
  await page.screenshot({ path: OUT });
  console.log(`截图已保存：${OUT}`);
  console.log(`页面标题：${await page.title()}`);
  console.log(`控制台错误：${errors.length ? errors.join('; ') : '无'}`);
} finally {
  await browser.close();
  server.stop();
}
