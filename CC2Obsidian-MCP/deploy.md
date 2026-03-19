# Obsidian DevTools MCP 部署教程

> 让 Claude Code 直接接入 Obsidian 控制台，实时监控插件运行状态。

---

## 架构原理

```
Claude Code (MCP Client)
    ↕ stdio
obsidian-devtools-mcp (MCP Server)
    ↕ CDP / WebSocket
Obsidian (Electron, port 9222)
```

Obsidian 基于 Electron（内嵌 Chromium），天然支持 Chrome DevTools Protocol (CDP)。
obsidian-devtools-mcp 作为中间层，将 CDP 能力封装为 MCP 工具暴露给 Claude Code。

---

## 前置条件

| 条件 | 说明 |
|------|------|
| Node.js | >= 18（推荐 20+），用于构建和运行 MCP 服务器 |
| npm | 随 Node.js 一起安装 |
| Claude Code | 已安装并可正常运行 |
| Obsidian | 已安装，版本不限 |
| Git | 用于克隆仓库 |

检查环境：

```bash
node -v    # 应输出 v18+ 或 v20+
npm -v     # 应输出 9+ 或 10+
claude --version
git --version
```

---

## 第一步：克隆并构建 MCP 服务器

### 1.1 克隆仓库

```bash
cd D:/Vault-4/Projects
git clone https://github.com/jjjjguevara/obsidian-devtools-mcp.git
cd obsidian-devtools-mcp
```

> 仓库位置：`D:\Vault-4\Projects\obsidian-devtools-mcp`

### 1.2 安装依赖

```bash
npm install
```

项目核心依赖：
- `@modelcontextprotocol/sdk` — MCP 协议 SDK
- `chrome-remote-interface` — CDP 客户端库

### 1.3 构建

```bash
npm run build
```

构建成功后会生成 `dist/index.js`，这是 MCP 服务器的入口文件。

验证构建结果：

```bash
ls dist/index.js
```

---

## 第二步：配置 Obsidian 启动参数

### 核心：开启远程调试端口

需要让 Obsidian 启动时带上 `--remote-debugging-port=9222` 参数。

### 方法 A：创建「Obsidian 开发者模式」快捷方式（推荐）

保留原始 Obsidian 快捷方式不动，另建一个专用于开发的快捷方式：

1. 复制桌面上的 Obsidian 快捷方式，粘贴为副本
2. 重命名为 **「Obsidian 开发者模式」**
3. 右键 → **属性**，在「目标」栏修改为：

```
"C:\Users\Smiling\AppData\Local\Programs\Obsidian\Obsidian.exe" --remote-debugging-port=9222
```

> 注意：引号包裹 exe 路径，`--remote-debugging-port=9222` 在引号外面。

4. 点击「确定」保存
5. 右键该快捷方式 → **固定到"开始"菜单**

这样你有两个入口互不影响：
- **Obsidian** — 日常使用，无调试端口
- **Obsidian 开发者模式**（开始菜单）— 插件开发时使用，开启 CDP 端口

### 方法 B：命令行启动（临时使用）

```bash
# 在 Git Bash / 终端中执行
"$LOCALAPPDATA/Obsidian/Obsidian.exe" --remote-debugging-port=9222 &
```

### 方法 C：创建专用启动脚本

在 `CC2Obsidian-MCP` 目录下创建 `start-obsidian-debug.bat`：

```bat
@echo off
start "" "%LOCALAPPDATA%\Obsidian\Obsidian.exe" --remote-debugging-port=9222
echo Obsidian started with remote debugging on port 9222
```

双击即可以调试模式启动 Obsidian。

### 验证调试端口是否开启

Obsidian 启动后，在浏览器中访问：

```
http://localhost:9222/json
```

如果返回一个 JSON 数组（包含 Obsidian 窗口信息），说明端口已成功开启。

---

## 第三步：注册 MCP 服务器到 Claude Code

### 3.1 注册命令

```bash
claude mcp add obsidian-devtools -- node "D:/Vault-4/Projects/obsidian-devtools-mcp/dist/index.js"
```

### 3.2 验证注册

```bash
claude mcp list
```

应能看到 `obsidian-devtools` 在列表中。

### 3.3 手动配置方式（备选）

如果 `claude mcp add` 命令有问题，可以手动编辑 Claude Code 的 MCP 配置文件。

配置文件位置（项目级）：`D:\Vault-4\Projects\The-Only-One-Tagger\.mcp.json`

```json
{
  "mcpServers": {
    "obsidian-devtools": {
      "command": "node",
      "args": ["D:/Vault-4/Projects/obsidian-devtools-mcp/dist/index.js"]
    }
  }
}
```

或者用户级配置（所有项目生效）：`~/.claude/settings.json` 中的 `mcpServers` 字段。

### 3.4 MCP 作用域说明

| 级别 | 配置文件 | 作用域 |
|------|----------|--------|
| **项目级** | 项目根目录 `.mcp.json` | 仅在该项目目录下启动 Claude Code 时加载 |
| **用户级** | `~/.claude/settings.json` | 所有项目都会加载 |

**推荐使用项目级配置**（上方 3.3 的 `.mcp.json`），这样只有在 `The-Only-One-Tagger` 项目下工作时才会启动 obsidian-devtools MCP 服务器，不影响其他项目。

---

## 第四步：连接测试

### 4.1 日常启动流程（先 Obsidian，后 Claude Code）

每次开发时的操作顺序：

```
① 从开始菜单启动「Obsidian 开发者模式」
      ↓  等待 Obsidian 完全加载
② 打开终端，cd 到项目目录，启动 Claude Code
      ↓  Claude Code 启动时自动拉起已注册的 MCP 服务器（无需手动启动）
③ 在 Claude Code 中说："连接到 Obsidian"
      ↓  建立 CDP 连接
④ 开始开发
```

> **MCP 服务器不需要手动启动。** Claude Code 启动时会自动运行所有已注册的 MCP 服务器进程。
> 你只需要确保 Obsidian 先启动好（端口 9222 就绪），然后启动 Claude Code 即可。

Claude Code 会调用 `obsidian_connect` 工具连接到 `localhost:9222`。

### 4.2 快速验证命令

连接成功后，试试这些指令：

```
"获取 vault 信息"           → 调用 obsidian_get_vault_info
"列出所有已安装的插件"       → 调用 obsidian_get_plugin_info
"列出所有可用命令"           → 调用 obsidian_list_commands
"截图当前 Obsidian 界面"     → 调用 obsidian_capture_screenshot
"读取控制台日志"             → 调用 obsidian_get_console_logs
```

---

## 可用工具一览

连接成功后，Claude Code 获得以下 MCP 工具：

### 连接管理

| 工具 | 说明 |
|------|------|
| `obsidian_connect` | 连接到 Obsidian（默认端口 9222） |
| `obsidian_disconnect` | 断开连接 |

### 控制台监控

| 工具 | 说明 |
|------|------|
| `obsidian_get_console_logs` | 获取缓冲的控制台输出（log / error / warn） |
| `obsidian_clear_console_logs` | 清空日志缓冲区 |

### 代码执行

| 工具 | 说明 |
|------|------|
| `obsidian_execute_js` | 在 Obsidian 渲染进程中执行任意 JavaScript（支持 await） |

### 插件管理

| 工具 | 说明 |
|------|------|
| `obsidian_reload_plugin` | 按 ID 热重载指定插件 |
| `obsidian_get_plugin_info` | 查询插件信息和 manifest |
| `obsidian_get_plugin_settings` | 读取插件设置 |
| `obsidian_get_store_state` | 读取插件的 Svelte store 状态值 |

### 命令系统

| 工具 | 说明 |
|------|------|
| `obsidian_list_commands` | 列出所有可用命令 |
| `obsidian_trigger_command` | 按 ID 执行指定命令 |

### Vault 信息

| 工具 | 说明 |
|------|------|
| `obsidian_get_vault_info` | 获取 vault 路径、名称等信息 |

### 截图

| 工具 | 说明 |
|------|------|
| `obsidian_capture_screenshot` | 截取整个视口或指定 CSS 选择器元素的截图 |

### 插件 MCP 桥接

| 工具 | 说明 |
|------|------|
| `obsidian_call_plugin_mcp` | 调用插件内嵌的 MCP 工具（插件需实现 mcpClient 接口） |

---

## 插件开发工作流

以 The-Only-One-Tagger 插件为例，部署完成后的日常开发流程：

### 常规开发循环

```
1. Claude Code 修改插件源码（src/）
2. 构建插件               → npm run build
3. 热重载插件              → obsidian_reload_plugin("the-only-one-tagger")
4. 读取控制台日志           → obsidian_get_console_logs
5. 发现报错 → Claude Code 分析并修复 → 回到第 1 步
6. 截图验证 UI             → obsidian_capture_screenshot
```

### 实用调试指令示例

```
# 查看插件当前设置
"执行 JS: console.log(JSON.stringify(app.plugins.plugins['the-only-one-tagger'].settings, null, 2))"

# 查看插件是否加载成功
"获取 the-only-one-tagger 插件信息"

# 测试特定功能后检查报错
"清空控制台日志，然后执行 XX 命令，再读取新的日志"

# 检查 DOM 结构
"截图侧边栏区域"
```

---

## 故障排查

### 问题：连接失败（无法连接到 9222 端口）

```bash
# 检查端口是否被 Obsidian 占用
netstat -ano | findstr :9222

# 如果没有输出，说明 Obsidian 未以调试模式启动
# 确认启动参数是否正确，重新启动 Obsidian
```

### 问题：`http://localhost:9222/json` 无响应

- 确认 Obsidian 确实在运行
- 确认启动参数 `--remote-debugging-port=9222` 没有拼写错误
- 确认端口 9222 未被其他程序占用（如果被占用，换一个端口，如 9333）

### 问题：MCP 服务器启动失败

```bash
# 手动测试运行
node "D:/Vault-4/Projects/obsidian-devtools-mcp/dist/index.js"

# 如果报错缺少模块，重新安装依赖
cd D:/Vault-4/Projects/obsidian-devtools-mcp
npm install
npm run build
```

### 问题：Claude Code 看不到 MCP 工具

```bash
# 确认 MCP 已注册
claude mcp list

# 如果没有，重新注册
claude mcp add obsidian-devtools -- node "D:/Vault-4/Projects/obsidian-devtools-mcp/dist/index.js"

# 重启 Claude Code
```

### 问题：端口 9222 被其他程序占用

换一个端口号，启动和连接时保持一致即可：

```bash
# 启动 Obsidian
"$LOCALAPPDATA/Obsidian/Obsidian.exe" --remote-debugging-port=9333

# 连接时指定端口
"连接到 Obsidian，端口 9333"
```

---

## 安全注意事项

- `--remote-debugging-port` 开启后，任何能连接该端口的程序都可以完全控制 Obsidian
- **仅在本地开发时开启**，不要在不受信任的网络环境中使用
- 开发完成后，用普通方式（不带调试参数）重启 Obsidian
- 如果担心安全问题，可以使用 `--remote-debugging-address=127.0.0.1` 限制只允许本机连接（这也是默认行为）

---

## 参考链接

- 仓库：https://github.com/jjjjguevara/obsidian-devtools-mcp
- MCP 协议文档：https://modelcontextprotocol.io
- Chrome DevTools Protocol：https://chromedevtools.github.io/devtools-protocol/
- Electron 远程调试：https://www.electronjs.org/docs/latest/tutorial/debugging-main-process
