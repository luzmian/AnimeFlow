# AnimeFlow V0.4.0 桌面集成说明

当前工程采用 Tauri 2 原生窗口、React/TypeScript 入口以及 Python 独立服务打包；本轮接入本地播放器、自动进度、字幕与离线弹幕。资料库、动态和历史的业务页面继续复用现有 HTML/CSS/JavaScript，不宣称已全部重写为 React 组件。SQLite 继续由服务管理。

## 你现在可以运行的版本

完整解压后，双击项目根目录的 `start-preview.bat`：已有 Python 3.10+ 即可，不需要 Node.js 或 Rust。它打开已经构建好的 React 界面预览，自动选取空闲端口；关闭命令窗口停止服务。预览运行在浏览器中，不是 Windows 桌面 EXE。也可以继续使用 `start.bat` 运行原浏览器入口。

追番、历史和主题继续使用 Windows `%LOCALAPPDATA%\AnimeFlow\user.sqlite3`。页面选择、动态模式、提醒基准与本轮弹幕设置使用 SQLite 持久化，不因随机端口改变而丢失。

## 原生构建状态

下列原生编译及独立服务二进制验证沿用 V0.3.0 的历史结果。V0.4.0 本轮执行前端构建、Python 测试与真实浏览器回归，未重新执行 Rust 原生编译或 Windows 打包。

- React/TypeScript 编译及真实浏览器渲染通过。
- Linux x64：Tauri Rust `cargo check`、`cargo build` 和 Rust URL 规则测试通过；Python 独立可执行服务已经构建并实际运行。
- 原生窗口自动化尝试被环境拒绝图形 Unix 套接字所阻断，GTK 未能启动。不能把 Chromium 页面验证当成原生窗口验证。
- 没有 Windows 构建机器；未生成、未验证 Windows EXE 或 NSIS 安装程序。
- `windows-desktop.yml` 仅提供构建流程，尚未执行，不是已生成安装包的证明。

## Windows 构建流程（开发环境用）

需要 Windows x64、Node.js 22 LTS、Python 3.12、Rust MSVC 工具链、Visual Studio C++ Build Tools 的“使用 C++ 的桌面开发”及 WebView2。普通使用者不必为了本次预览安装这些开发工具。

在 `desktop` 目录用 PowerShell 执行：

```powershell
./build-windows.ps1
```

脚本安装固定版本 PyInstaller，按 `package-lock.json` 安装前端依赖，构建前端、打包 Windows 本地服务，然后构建 Tauri 和 NSIS。遇到失败立即停止，不会输出“已生成”结论。构建结果应位于 `desktop/src-tauri/target/release/bundle/nsis/`。仅复制 `animeflow.exe` 不构成完整部署；还需要服务二进制与界面资源，优先使用安装程序。

配置在首次缺失时通过 Microsoft WebView2 安装引导获取 WebView2；此流程需要网络，未在大陆 Windows 真机验证。

## 运行设计

- Tauri 启动独立服务，传入随机会话和父进程 PID。服务仅监听 `127.0.0.1` 的随机端口。
- 服务输出不含令牌的就绪 JSON；React 启动页取得地址后跳转到同源界面。会话引导跳转会移除地址中的令牌，使用 HttpOnly、SameSite=Lax 会话 Cookie，POST 继续校验真实端口的 Origin。
- 服务静态路由只开放必要页面及构建资源，不开放用户数据库。播放器与字幕使用本地 Blob URL；内容安全策略明确允许媒体 Blob，视频文件不经过网络服务。服务退出时原生程序退出；原生程序退出时关闭服务，另有父进程退出监测。
- Rust 原生导航限于本地应用与当前服务端口；官方链接由已登记 URL 规则校验后交给系统浏览器。此原生链路仅做过编译和规则单元测试，没有实际打开 Windows 浏览器。
- 单实例插件已接入，实际窗口聚焦/重复启动行为未验证。

## 复现测试

```text
python -m unittest discover -s tests
cd desktop
npm ci
npm run build
python -m pip install -r requirements-build.txt
npm run sidecar
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`tests/browser_desktop.cjs` 使用 Playwright 运行真实打包服务和 React 构建界面；需要外部 Chromium 与 Playwright，路径可由 `CHROMIUM_PATH` 指定。`tests/native_desktop.py` 用 tauri-driver、WebKitWebDriver 和 Xvfb 尝试真正的原生窗口测试，测试工具根目录通过 `AF_BUILD_TOOLS` 配置，当前环境结果为阻断。

## 当前未完成

完整 React 组件迁移、授权在线播放源、弹弹play 在线弹幕鉴权接入、Windows 安装/升级/卸载验证及资源占用测量。本地播放器、SQLite 自动进度、字幕与离线弹幕已实现并在 Chromium 中验证，尚未在 Windows WebView2 真机验证。预计播出仍不代表平台已经更新；官方链接授权期限未实时核验。

参考：

- https://v2.tauri.app/develop/sidecar/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/develop/tests/webdriver/

在线弹幕接入文档：https://doc.dandanplay.com/open/。本轮只研究了官方申请、签名及缓存规范，没有凭证，未调用在线授权接口。
