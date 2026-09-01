# DSH Markdown — 智能 Markdown 知识库

**本地优先的 Markdown 知识库 · Apple Silicon 原生 · 集成 DeepSeek AI**

一个 macOS 上的 Markdown 知识库应用：双向链接、五种视图、思维导图、知识图谱、AI 助手、网页转笔记、截图转笔记。

新增 electron 支持，构建Windows环境下应用。

![主界面](docs/manual/images/01-main.png)

## 功能速览

### 🚀 五分钟上手

双击打开，首次进入欢迎页，选一个文件夹作为知识库（建议新建空目录，如 `~/Documents/dsh-notes`）：

![欢迎页](docs/manual/images/00-welcome.png)

空知识库自动生成示例笔记并预置目录。进入主界面：左边文件树、中间工作区、右边面板、底部状态栏（字数统计中文按字、英文按词）。工具栏 ✚ 新建笔记，同名自动加 `-2` 后缀。

默认分栏模式，左边写、右边实时渲染，停止输入 800ms 自动落盘：

![分栏编辑](docs/manual/images/02-split.png)

### 🗺 思维导图：长文结构一图看尽

点「🗺 导图」，整篇笔记的标题层级变成可缩放的思维导图，按深度循环着色，代码块自动忽略只留大纲骨架。梳理长文结构、回顾读书笔记时特别顺手：

![思维导图](docs/manual/images/05-mindmap.png)

### 🕸 知识图谱：笔记不再是孤岛

点「🕸 图谱」，全库 `[[链接]]` 关系画成网络。**局部模式**以当前笔记为中心展开 1–3 层邻居（可按出链/入链/双向过滤，对齐 Obsidian Local Graph）；**全库模式**看知识聚簇、发现孤岛笔记。点击节点直接打开笔记：

![知识图谱](docs/manual/images/06-graph.png)

### 🔗 双向链接：写作思路不断

输入 `[[` 弹出全库笔记名模糊补全；预览里点击链接，笔记不存在就**自动创建**——想到相关概念随手链过去，不用停下来建文件、起名字：

![双链补全](docs/manual/images/07-wikilink.png)

右栏「链接」标签双向展示：← 谁引用了我，→ 我引用了谁。链接索引由 Rust 并行扫描全库生成，万级笔记也不卡：

![反向链接](docs/manual/images/08-backlinks.png)

### 🔀 Mermaid 流程图 + 内嵌导图

` ```mermaid ` 代码块渲染流程图/甘特图/时序图，语法错误不崩溃、原码保留；` ```markmap ` 在笔记任意位置内嵌局部思维导图：

![Mermaid](docs/manual/images/10-mermaid.png)

### 🤖 AI 助手（DeepSeek）

右栏「AI 助手」，流式对话逐字渲染，多会话本地持久化（时钟图标看历史、加号新建）：

![AI 助手](docs/manual/images/12-ai.png)

勾选「笔记上下文」后，AI 是**读过你这篇笔记**的助手——「帮我整理成周报」「这段有没有更简洁的表达」「根据内容补三个待办」：

![笔记上下文](docs/manual/images/13-context.png)

**🌐 网页转笔记**：粘贴链接一键成文。Rust 抓取正文（剔除广告/导航/脚本）→ AI 整理成结构化中文笔记 → 生成 Obsidian Web Clipper 同款 front-matter 存入 `Clippings/`。**微信公众号文章配图自动下载本地化**（微信图片有防盗链，外链显示不出）。

**📷 截图转笔记**（视觉模型 `deepseek-v4-flash-vision-exp`）：应用自动隐藏避免遮挡 → 系统截图 → 自动恢复 → **无需任何手动操作**转成 Markdown 笔记。数据表格逐行识别成 Markdown 表格；腾讯文档/飞书/Notion 等 JS 渲染页面，截图就是万能入口。

**🖼 图片粘贴**：⌘V 或拖拽进编辑器，自动归档到 `attachments/年/月/时间戳-原名`，光标处插入相对路径引用——附件永不散乱。

### 更多细节

- **⌘P 快速打开**：全库模糊搜索，回车即开

  ![快速打开](docs/manual/images/16-quickopen.png)

- **浅色 / 深色 / 跟随系统**：

  ![主题](docs/manual/images/15-light.png)

- **大文件**：>2MB 自动切「仅编辑」模式，10MB+ 依旧流畅（CodeMirror 视口增量渲染）
- **外部修改感知**：文件被其他程序改动自动提示重载
- **原子写入**：先写临时文件再重命名，断电不留半截文件

## 🖥 运行环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| macOS | 13+ | Apple Silicon（M1/M2/M3）；Intel 未测试 |
| Node.js | ≥ 20 | 建议 22（含 npm ≥ 10） |
| Rust | ≥ 1.77 | 经 [rustup](https://rustup.rs) 安装 |
| Xcode Command Line Tools | — | `xcode-select --install` |
| DeepSeek API Key | 可选 | 不填可正常用作纯编辑器；AI 功能需要 |

## 🚀 快速开始

```bash
git clone https://github.com/yueyezhufeng/dsh-markdown.git
cd dsh-markdown
npm install
npm run tauri dev   # 首次全量编译 Rust，约 2–3 分钟
```

## 📦 构建 Release 版

```bash
npm run tauri build
```

- **应用**：`src-tauri/target/release/bundle/macos/DSH Markdown.app`（拖入 /Applications）
- **安装包**：`src-tauri/target/release/bundle/dmg/DSH Markdown_0.1.0_aarch64.dmg`

> 应用为 ad-hoc 签名，首次打开需右键 → 打开；重装后 macOS「屏幕录制」授权需重新勾选并 ⌘Q 重启应用。

## 📁 目录结构

```
dsh-markdown/
├── docs/manual/                  # 功能截图（本 README 素材）
├── src/                          # 前端（React 19 + TypeScript）
│   ├── components/               #   UI 组件
│   │   ├── Editor.tsx            #     CodeMirror 6 编辑器
│   │   ├── Preview.tsx           #     Markdown 预览（mermaid/markmap 按需加载）
│   │   ├── MindmapView.tsx       #     全文思维导图
│   │   ├── GraphView.tsx         #     局部/全库关系图谱（canvas 力导向）
│   │   ├── AiPanel.tsx           #     AI 助手（会话/网页转笔记/截图转笔记）
│   │   └── ...                   #     文件树/大纲/反链/快速打开/设置
│   ├── lib/                      #   核心逻辑
│   │   ├── cm.ts                 #     CodeMirror 配置（双链补全/图片粘贴）
│   │   ├── markdown.ts           #     markdown-it 渲染管线
│   │   ├── ai.ts                 #     DeepSeek 流式客户端（多模态）
│   │   └── store.ts / wikilink.ts
│   └── styles/global.css         #   主题变量（浅/深）
├── src-tauri/                    # 后端（Rust + Tauri 2）
│   ├── src/
│   │   ├── fs.rs                 #     文件树/读写/搜索/链接索引/附件归档
│   │   ├── ai.rs                 #     OpenAI 兼容 SSE 流式代理（推理模型双通道）
│   │   ├── chats.rs              #     AI 会话持久化
│   │   ├── fetch.rs              #     网页抓取/微信图片下载/交互截图
│   │   └── watcher.rs / config.rs
│   ├── capabilities/default.json #   插件权限声明（ACL）
│   └── tauri.conf.json           #   窗口/打包/asset 协议配置
├── scripts/gen-icon.mjs          # 应用图标生成（纯 Node，无依赖）
├── LICENSE                       # Apache-2.0
└── README.md
```

## ⌨️ 快捷键

| 按键 | 功能 |
|---|---|
| `⌘P` | 快速打开笔记 |
| `⌘S` | 立即保存（平时 800ms 自动保存） |
| `⌘\` | 侧栏开关 |
| `⌘B / ⌘I / ⌘K` | 粗体 / 斜体 / 链接 |
| `⌘↩` | AI 发送 / 转笔记（跟随主按钮） |
| `[[` | 双链补全 |

## 🔐 隐私说明

- 笔记、附件、AI 会话全部存放在你的知识库目录，纯本地
- DeepSeek API Key 仅存本机（`~/Library/Application Support/com.zhufeng.zf-markdown/config.json`），不上传任何第三方，不在源码中

## 🧰 技术栈

Tauri 2 · React 19 · TypeScript · Vite 7 · CodeMirror 6 · markdown-it · mermaid · markmap · zustand · Rust（notify / reqwest / rayon / tokio）

## ⚡ 性能设计（M1 不发热）

- Tauri 2 + WKWebView 系统组件，非 Electron；mermaid / markmap / 语法包全部按需 `import()`，空闲零占用
- 大文件自动禁用实时预览；文件监听走 FSEvents 事件驱动，零轮询
- 图谱力导向动画收敛后自动降频

## 📄 License

[Apache-2.0](LICENSE) © The DSH Markdown Authors
