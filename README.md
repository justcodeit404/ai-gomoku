## 五子棋AI

✨🎉🎉🎉✨ 2023/11 重写了全部代码，代码更加简洁易懂，并修复了之前存在的AI可能会偶尔走错棋的问题，棋力更加稳定，React也更新到了最新的V18版本。

***本仓库代码仅供个人业余研究AI用，代码肯定存在有很多不完善的地方，精力和专业所限请谅解***

打开此页面可以直接体验 [https://gobang2.light7.cn/](https://gobang2.light7.cn/) 如果 `http` 协议无法打开，可以用这个http的链接 [http://gobang2.light7.cn/](http://gobang2.light7.cn/)

桌面版基于 Electron + Rapfi C++ 引擎，棋力远超浏览器版本。

如果你对机器学习、神经网络有兴趣，这里有一个基于Alpha Zero原理的AI [alpha-zero-gobang](https://github.com/lihongxun945/alpha-zero-gobang) 正在开发中，Tensorflow2.x实现，有兴趣的可以关注交流。

## 一些常见问题
- Q：AI的原理是什么？
- A：在线版本基于极小化极大搜索算法，桌面版集成 Rapfi C++ 引擎（Gomocup/pbrain 协议），棋力远超浏览器版本。没有用到神经网络、强化学习之类的机器学习算法。
- Q：为什么感觉AI的棋力不强？
- A：在线版本受限于浏览器执行JS的速度，搜索深度较浅。建议使用桌面版，集成 Rapfi 引擎，棋力大幅提升。
- Q：不同难度有啥区别？
- A：不同难度的区别在于搜索的深度，AI的搜索深度越深，棋力越强，相应的耗时也会变长。
- Q：需要联网吗？
- A：第一次打开页面或者刷新需要联网，但AI的执行是本地的，因此只要页面打开之后，就不需要联网了。
- Q：为啥感觉电脑走棋很慢？
- A：这个AI是本地浏览器执行的，AI的速度受硬件性能影响比较大，并且难度越高，搜索的深度越深，耗时越长。如果发现耗时过长，可以降低难度。
- Q：AI涉及到的算法是你原创的吗？
- A：并不是我原创的，绝大部分都是网络上公开的算法，我只是把它们组合起来，并做了一些有限的优化。

## 联系方式

需要交流的同学可以加QQ群 `622613966`,进群验证信息请填写 `gobang`

## 更新日志

- 2023/11/23 更新：V3版本重写了所有代码，现在代码更加简洁易懂，并修复了之前存在的AI可能会偶尔走错棋的问题，棋力更加稳定。
- 2020/11/29 更新: 修复了评分的明显bug，随机开局库可配置，网站已修复，可以愉快玩耍了

## 教程
我写了一个系列博客，教你如何一步步编写自己的五子棋AI：

- [五子棋AI设计教程第二版一：前言](https://github.com/lihongxun945/myblog/issues/11)
- [五子棋AI设计教程第二版二：博弈算法的前世今生](https://github.com/lihongxun945/myblog/issues/12)
- [五子棋AI设计教程第二版三：极小化极大值搜索](https://github.com/lihongxun945/myblog/issues/13)
- [五子棋AI设计教程第二版四：Alpha Beta 剪枝算法](https://github.com/lihongxun945/myblog/issues/14)
- [五子棋AI设计教程第二版五：启发式评估函数](https://github.com/lihongxun945/myblog/issues/15)
- [五子棋AI设计教程第二版六：迭代加深](https://github.com/lihongxun945/myblog/issues/16)
- [五子棋AI设计教程第二版七：Zobrist缓存](https://github.com/lihongxun945/myblog/issues/17)
- [五子棋AI设计教程第二版八：算杀](https://github.com/lihongxun945/myblog/issues/18)
- [五子棋AI设计教程第二版九：性能优化](https://github.com/lihongxun945/myblog/issues/19)

注意教程中的代码与代码仓库的有一定区别，但原理是一样的。作者本着开源分享的精神，知道的都写出来，没有任何保留，如有遗漏或错误可以提issue。


## 桌面版（Electron 打包）

本项目可打包成 Windows 桌面应用：

```bash
npm install
npm run dist   # 等价于 npm run build + npx electron-builder --win portable
```

产物：`release/AI五子棋.exe`，双击即可运行，无需安装。

> 如果打包时因网络问题下载 Electron 失败，可设置本地缓存后重试：
> ```bash
> # PowerShell
> $env:ELECTRON_CACHE="$env:LOCALAPPDATA\electron\Cache"
> npm run dist
> ```

### 引擎说明

桌面版默认集成 **Rapfi** 五子棋引擎（Gomocup/pbrain 协议），由主进程 `spawn` 子进程驱动，并通过 Electron IPC 暴露给渲染进程。Rapfi 是 C++ 实现的开源强引擎，棋力远超浏览器内置的 JS 引擎。

文件布局（打包前需自行准备）：

```
release/rapfi/
├── Rapfi.exe            # 重命名自 pbrain-rapfi_avx.exe（兼容性最好）
├── pbrain-rapfi_avx2.exe
├── config.toml          # Rapfi 配置文件
├── *.dll                # 运行依赖（libgcc/libstdc++/winpthread/tbb）
└── *.bin / *.bin.lz4    # 网络权重文件
```

若 `release/rapfi/Rapfi.exe` 不存在，桌面版将无法加载引擎。

## 安装依赖
本仓库前端基于 React + Redux，桌面端基于 Electron。本地开发需安装 Node 和 NPM，建议 Node v18+。

先执行 `npm install` 安装依赖。常用命令：

- `npm start` 启动本地开发服务
- `npm test`  运行单元测试
- `npm run build` 编译 React 产物到 build/
- `npx electron-builder --win portable` 打包 Windows 便携版 exe

## 关于作者
大厂前端工程师，曾（现）任职百度、阿里、字节等公司，业务时间会研究一些和工作无关的技术。