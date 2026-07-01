# AI 五子棋

基于 Electron + React + Rapfi 引擎的 Windows 桌面五子棋应用。

## 特性

- **AI 对弈**：集成 Rapfi C++ 引擎，棋力强劲。
- **AI 先手 / 人类先手**：开局前可切换。
- **悔棋**：撤销最近两步（人类一步 + AI 一步），以 UI 显示局面为准，避免状态漂移。
- **禁手规则**：可选启用 RIF 禁手（黑棋禁双三、双四、长连）。
- **历史记录**：保存并复盘历史对局。
- **AI 提示**：请求 AI 给出当前局面的推荐着法。
- **主题切换**：明亮 / 深色 / 木纹三种棋盘主题。

## 技术栈

- 前端：[React 18](https://react.dev/) + [Redux Toolkit](https://redux-toolkit.js.org/) + [Ant Design](https://ant.design/)
- 桌面：[Electron 31](https://www.electronjs.org/)
- 引擎：[Rapfi](https://github.com/dhbloo/Rapfi)（Gomocup / pbrain 协议）
- 打包：[electron-builder](https://www.electron.build/)

## 快速开始

### 环境要求

- Node.js 18+
- Windows（当前仅维护 Windows 桌面版）

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm start
```

这会启动 React 开发服务器，并通过 Electron 打开桌面窗口。

### 打包

```bash
npm run dist
```

产物为 `release/AI五子棋.exe`，便携版，双击即可运行。

## 引擎说明

桌面版通过 Electron 主进程 `spawn` Rapfi 子进程，使用 Piskvork / Gomocup 协议通信。Rapfi 需要与以下文件同目录：

```
release/rapfi/
├── Rapfi.exe            # 主程序（建议用 pbrain-rapfi_avx.exe 重命名，兼容性最好）
├── pbrain-rapfi_avx2.exe
├── config.toml          # Rapfi 配置
├── *.dll                # 运行时依赖
└── *.bin / *.bin.lz4    # 网络权重
```

打包时 `release/rapfi/` 会被复制到 `resources/rapfi/`。

## 项目结构

```
├── electron-main/        # Electron 主进程
│   ├── rapfi-bridge.js   # Rapfi 进程管理、Piskvork 协议实现
│   ├── ipc-handlers.js   # IPC 通信
│   ├── engine-paths.js   # 引擎路径解析
│   └── logger.js         # 主进程日志
├── src/
│   ├── gui/              # React 组件与 UI
│   ├── store/            # Redux 状态管理
│   ├── game/             # 胜负判定、棋谱格式
│   ├── persistence/      # 本地设置存储
│   ├── bridge.js         # 渲染进程 ↔ 主进程桥接
│   ├── preload.js        # Electron preload 脚本
│   └── config.js         # 默认配置
├── release/
│   ├── rapfi/            # 引擎资源（不参与 git）
│   └── AI五子棋.exe      # 打包产物（不参与 git）
└── build/                # React 构建产物（不参与 git）
```

## 注意事项

- 悔棋逻辑以 UI 显示的历史为准重建局面，避免引擎内部状态漂移导致 AI 走出离谱位置。
- `release/rapfi/` 与打包产物体积较大，未提交到 git。如需从源码构建，请自行准备 Rapfi 引擎文件。

## License

本项目基于原 [gobang](https://github.com/lihongxun945/gobang) 项目重构，仅用于个人学习研究。
