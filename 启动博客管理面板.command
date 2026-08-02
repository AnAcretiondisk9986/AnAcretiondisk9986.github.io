#!/bin/bash
# macOS 一键启动：博客管理面板（等价于 Windows 的 启动管理面板.bat）
cd "$(dirname "$0")"
echo ""
echo "╔══════════════════════════════════╗"
echo "║   Acretiondisk 博客管理面板     ║"
echo "╠══════════════════════════════════╣"
echo "║  正在启动...                    ║"
echo "║  浏览器将自动打开管理界面       ║"
echo "║  Ctrl+C 即可停止服务器          ║"
echo "╚══════════════════════════════════╝"
echo ""
node admin-server.mjs
