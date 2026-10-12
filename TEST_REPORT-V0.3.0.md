# AnimeFlow V0.3.0 测试报告

日期：2026-10-10。基于用户已确认正常的 V0.2.3 项目继续开发。本轮完成桌面集成代码与可运行的 React 浏览器预览，不把构建脚本或 Linux 编译当成 Windows EXE 交付。

## 实际修改

新增 `desktop/`：Tauri 2、React 19、TypeScript、Vite 生产构建、Rust 服务启动与生命周期管理、官方链接打开规则、单实例配置、图标、前端和 Rust 依赖锁文件、Windows 打包脚本及 CI 模板。

现有 Python 服务增加随机端口、桌面会话 Cookie、同源 POST 校验、受限构建资源路由、父进程监测与就绪协议；普通 `start.bat` 入口保持兼容。打包服务含 Python 运行时，用户原生版运行时不需要单独安装 Python，此点实际验证限 Linux 服务二进制。

当前页、动态模式及提醒基准迁入 SQLite，避免随机端口改变后丢失浏览器偏好。现有页面业务代码继续复用，没有伪称已经全部 React 化。

新增 `preview.py` 和 `start-preview.bat`，使用预构建前端打开浏览器预览；它不是原生 EXE。

## 已通过

- Python 自动化：34 项，通过。新增服务授权、Origin、路径越界、父进程退出、SQLite 偏好以及预览启动/关闭服务校验；这些包含受控数据，不能视作 Bangumi 真实联网测试。
- `npm run build`：TypeScript 检查与 Vite 构建通过，主 JavaScript 约 198 KB、CSS 约 6 KB（未压缩）。
- npm 依赖审计发现原 Vite 7.2.2 开发依赖有一项高风险告警，更新至固定 Vite 7.3.7 后重新构建和回归；最终审计结果见 `evidence/npm-audit-v030.json`。
- Linux Rust：`cargo check`、`cargo build` 通过。生成实际 ELF 可执行文件约 39 MB；不是 Windows EXE。Rust 官方 URL 规则测试 1 项通过。
- PyInstaller 6.22.3：生成 Linux x64 独立服务约 13 MB，实际直接执行服务二进制成功。
- 真实 Chromium + 打包服务 + React 生产界面：资料库 24 张封面、详情与已播出集数、动态七天日历、无已读按钮、分页和底部不连锁加载通过；会话 Cookie 不可由 JavaScript 读取，未授权 API 返回 403；重新启动到另一随机端口、使用全新浏览器存储后，历史记录页从 SQLite 恢复。结果见 `evidence/browser-desktop-v030.json`。
- 冷数据库直接执行已打包独立服务、经本地转发实际请求 Bangumi `/v0/subjects/12` 成功，返回条目 12「ちょびっツ」，8.966 秒；见 `evidence/live-packaged-v030.json`。该请求没有预置缓存或模拟数据。
- 原浏览器入口回归：资料库分页、评分排序、类型/地区/题材筛选、搜索、详情、追番、SQLite 历史恢复、删除历史、主题通过。
- V0.2.3 修复回归：刷新留页、动态模式、封面节点保持、底部停留停止加载、再次滚动继续加载与受控新动态红点场景；精确结果见 `evidence/browser-fixes-v023.json`（测试脚本沿用该文件名，内容为本轮重跑结果）。

资料库和动态浏览使用 Bangumi 实际资料及缓存，不用模拟动漫填充界面。本轮侧重桌面集成，没有重新执行十二季度全网抓取或 2,400 条长列表测试；此前报告保留，只能算先前验证。本轮未将受控红点响应冒充实时新增资料。

## 阻断与未验证

尝试用真实 Tauri ELF、tauri-driver 2.1.0、WebKitWebDriver 2.52.3 和 Xvfb 运行原生窗口。环境拒绝创建图形 Unix 套接字，DBus/Xvfb 报 `Operation not permitted`，GTK 无法初始化。原生窗口检查没有通过，见 `evidence/native-desktop-v030.json`。原生浏览器跳转、单实例聚焦、窗口关闭后服务退出仍需原生环境实测；Python 父进程监测和独立服务启动已分别测试，不等于这些原生链路已通过。

没有 Windows 环境：Windows EXE、NSIS、WebView2 引导、安装/卸载、升级保留数据库、官方链接调用系统浏览器未测。Windows 构建脚本和 CI 模板均未执行，不提供未验证的安装程序。无 CPU/内存实测数字，不声称达到性能目标。

最终包解压到全新临时目录后，实际运行所交付 `preview.py`，完成会话引导、React 资源、本地接口、空用户状态、我的动态真实末尾及关闭预览后服务退出检查，CRC 校验通过。见 `evidence/delivery-v030.json`。浏览器自动打开在此检查中用捕获地址代替，未将这个受控启动动作称为 Windows 默认浏览器验证。

## 交付

完整源码、预构建 React 界面、原浏览器和预览启动入口、Windows 构建文件、测试脚本和报告。排除用户数据库、缓存、node_modules、编译中间文件。Linux 本地构建结果仅用于验证，不混作 Windows 发布文件。
