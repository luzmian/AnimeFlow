# 数据来源与许可

## bangumi-data

平台页面映射来自 bangumi-data：
https://github.com/bangumi-data/bangumi-data

原数据采用 Creative Commons Attribution 4.0 International（CC BY 4.0）：
https://creativecommons.org/licenses/by/4.0/

本项目于 2026-10-10 获取其 dist/data.json，保留国内视频平台的 onair 类型页面，剔除资源下载站点；这是经过筛选的衍生数据。原文件 SHA-256 存在 assets/platform-links.json 的 upstream_sha256 字段中。

映射是社区登记的平台页，不是嵌入播放许可，也不证明页面目前可用、仍有授权或有中文字幕。没有提取流媒体地址。

## Bangumi

动漫、放送表与章节资料来自 Bangumi 公共 API：https://api.bgm.tv
官方接口说明：https://github.com/bangumi/api
页面保留单一来源评分和社区资料含义。章节日期不等于视频平台上线记录。

## 桌面前端依赖

预构建界面包含 React / React DOM（MIT）及 @tauri-apps/api（MIT / Apache-2.0）。许可文本随包保存在 desktop/licenses。Node、Rust、Vite、PyInstaller 是构建依赖，不作为本次预览的外部运行要求；本源码包未附 Windows 或 Linux 原生发行二进制。依赖版本见 package-lock.json 与 Cargo.lock。

## 本地播放器示例

`examples/test-video.webm` 为本项目使用 FFmpeg 合成的测试图与音频，不含动漫片源，按 CC0 提供。示例字幕与弹幕由本项目编写。运行软件不依赖 FFmpeg；FFmpeg 仅用于开发测试和生成示例。弹弹play文档用于接口研究，本包没有在线 API 凭证或从在线接口下载的弹幕。
