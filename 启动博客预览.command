#!/bin/bash
# macOS 一键启动：博客本地预览（Astro 开发服务器）
cd "$(dirname "$0")"
echo ""
echo "╔══════════════════════════════════╗"
echo "║   Acretiondisk 博客本地预览     ║"
echo "╠══════════════════════════════════╣"
echo "║  正在启动 Astro 开发服务器...   ║"
echo "║  预览地址: http://localhost:4321 ║"
echo "║  Ctrl+C 即可停止                ║"
echo "╚══════════════════════════════════╝"
echo ""
npm run dev
