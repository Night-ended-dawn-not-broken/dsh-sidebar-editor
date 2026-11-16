# 侧边栏编辑器（dsh-sidebar-editor）

DeepSeek Harness 右侧边栏插件：在右侧标签页里编辑文件、管理文件夹，并完成 Git 状态、初始化、克隆、拉取、提交和推送。

## 功能

- **文件编辑器**：从「文件」标签页的 Edit 动作或文件管理器中打开任意工作区文本文件，按版本号保存，外部修改会提示冲突而不是直接覆盖。
- **文件管理器**：浏览、新建文件/文件夹、重命名、删除；列表限制在会话工作区内。
- **Git 面板**：查看分支、上游、领先/落后和变更；初始化仓库、克隆、fetch、快进 pull、选择性提交、push。
- **本地实现**：不依赖第三方服务。Host 端的本地 JSON 路由只监听回环地址，并带自定义请求头校验；读、写、建目录、删除等操作都走会话的 sandbox policy。

## 安装

要求 DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`，Node.js 20+。

从 GitHub 安装（纯 JavaScript，无需构建步骤）：

```sh
dsh plugin --profile desktop add github:Night-ended-dawn-not-broken/dsh-sidebar-editor
```

从本地目录安装：

```sh
dsh plugin --profile desktop add ./dsh-sidebar-editor
```

安装后重启 Harness。插件会作为 bundle 出现在「设置 → 插件」中，右侧边栏出现「文件」「Git」入口。

## 使用

- **编辑文件**：右侧「文件」标签页中右键或点击文件旁的 Edit；保存时使用打开时的版本号，若磁盘内容已被改动，保存会返回冲突。
- **管理目录**：文件管理器顶部的按钮支持新建文件、新建文件夹、重命名和删除。
- **Git**：打开「Git」标签页。非仓库目录会提示初始化或克隆；仓库内可刷新状态、fetch、快进 pull、勾选文件提交、push。认证沿用本机 Git 凭据（credential helper / SSH key），插件不保存任何凭据。

## 数据与安全

- 插件本身不落盘任何用户数据，也不缓存文件内容。
- 文件读写受会话的 sandbox policy 约束：`read-only` 拒绝一切修改，`workspace-write` 只允许工作区和临时目录，`danger-full-access` 不额外限制。
- 所有路由要求 `x-dsh-plugin: sidebar-editor` 请求头；浏览器跨站请求会因缺少该头而被拒绝。
- Git 命令以非交互方式执行（`GIT_TERMINAL_PROMPT=0`），不会弹出凭据输入框。

## 目录结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 入口：文件与 Git 的本地 HTTP 路由 |
| `client.js` | Client 入口：右侧边栏标签页、文件管理器和 Git 面板 |
| `cordis.patch.yml` | bundle patch：插入 `sidebar-editor` Host 行 |
| `locale/` | 中英文文案 |
| `icon.svg` | 插件图标 |

## 开发

```sh
node --check index.js
node --check client.js
```

Host 端改动需要重启 Harness 才生效。

## 许可

MIT
