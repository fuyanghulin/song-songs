# 留声

一个按固定目录浏览、播放歌曲并同步显示 LRC 歌词的响应式音乐网站。技术栈为 React、TypeScript 与 Vite。

## 本地运行

```bash
npm install
npm run dev
```

本地媒体目录：

- `songs/歌曲名.mp3`
- `lyrics/歌曲名.lrc`

安装 FFmpeg（需能直接运行 `ffprobe`）后，若 MP3 来自网易云且保留了原始 `163 key` 标签，可按歌曲 ID 自动补齐同步歌词：

```bash
npm run lyrics:sync
```

该命令默认保留已有歌词；需要重新获取时使用 `npm run lyrics:sync -- --force`。

## GitHub Pages

运行以下命令会构建 `dist/`，并把静态网站发布到仓库的 `gh-pages` 分支：

```bash
npm run deploy
```

当前仓库会直接提交 `songs/` 和 `lyrics/` 内的媒体文件，构建时自动复制到 Pages 产物中。

如果以后曲库增大，也可以把文件迁移到支持 HTTPS、CORS 和 Range 请求的对象存储，并在构建或部署前设置环境变量：

```text
VITE_MEDIA_BASE_URL=https://media.example.com/music/
```

该地址下应保持以下结构：

```text
songs/如果当时.mp3
lyrics/如果当时.lrc
```

如果不配置 `MEDIA_BASE_URL`，网站会直接从 GitHub Pages 项目路径下的 `songs/` 和 `lyrics/` 读取文件。

## 说明

本项目与网易云音乐无关联，界面仅参考现代音乐客户端的通用布局语言。
