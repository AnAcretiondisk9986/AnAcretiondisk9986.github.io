@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ╔══════════════════════════════════╗
echo ║   Acretiondisk 博客管理面板     ║
echo ╠══════════════════════════════════╣
echo ║  正在启动...                    ║
echo ║  浏览器将自动打开管理界面       ║
echo ║  关闭本窗口即可停止服务器       ║
echo ╚══════════════════════════════════╝
echo.
node admin-server.mjs
pause
