# Figma Automation Platform

通过 Figma Plugin API + Bridge Server + MCP 协议，实现 Claude Code 对 Figma 的完整读写操控。

## 特性

- **52 个 Semantic Tools** — AI 调用的高级语义工具，一次 Tool Call 完成复杂设计操作
- **无调用限制** — 基于 Plugin API，不受 REST API 120 req/min 限流
- **读写双向** — 完整的创建、修改、删除、导出能力
- **毫秒级响应** — WebSocket 本地通信，无需网络往返
- **语义注册表** — 通过语义标签定位和批量操作节点
- **设计 Token** — Variables CRUD，支持多模式（light/dark）
- **组件变体** — Component Variants 的创建和实例化
- **事件监听** — 实时监听文档变化
- **批量回滚** — 批量操作失败时自动回滚已创建的节点
- **Diff Engine** — 增量更新，只发送变化的属性
- **模板系统** — 预定义设计模板，参数化生成
- **REST API** — HTTP 接口作为 MCP 的补充

## 快速开始

### 前置条件

- Node.js >= 18
- pnpm
- Figma Desktop（或 Figma Web）

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd figma-automation-platform

# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

### 配置 Figma Plugin

1. 打开 Figma Desktop
2. 进入 Plugins → Development → Import plugin from manifest
3. 选择 `packages/plugin/manifest.json`
4. 运行 Plugin，UI 应显示 "Connected to Bridge"

### 配置 Claude Code MCP

项目已包含 `.mcp.json`，Claude Code 会自动识别。MCP Server 通过 stdio 通信：

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["packages/bridge/dist/index.js"]
    }
  }
}
```

### 启动 Bridge Server

```bash
pnpm dev:bridge
```

Bridge Server 会同时启动：
- WebSocket Server (端口 37849) — 与 Figma Plugin 通信
- MCP Server (stdio) — 与 Claude Code 通信
- REST API (端口 37850) — HTTP 接口

## 项目结构

```
figma-automation-platform/
├── packages/
│   ├── shared/          # 共享类型定义
│   ├── bridge/          # Bridge Server (MCP + WebSocket + HTTP)
│   │   └── src/
│   │       ├── index.ts           # 入口
│   │       ├── mcp-server.ts      # MCP Server
│   │       ├── ws-server.ts       # WebSocket Server
│   │       ├── http-server.ts     # REST API Server
│   │       ├── command-router.ts  # 命令路由
│   │       └── semantic/          # 语义层
│   │           ├── tools.ts       # 52 个 Semantic Tools
│   │           ├── primitives.ts  # Primitive Commands 封装
│   │           ├── registry.ts    # 语义注册表
│   │           └── templates.ts   # 模板注册表
│   └── plugin/          # Figma Plugin
│       └── src/
│           ├── code.ts            # 主线程
│           ├── ui.html            # UI iframe
│           └── commands/          # 命令处理器
│               ├── read.ts        # 读取
│               ├── create.ts      # 创建
│               ├── modify.ts      # 修改
│               ├── variables.ts   # Variables CRUD
│               ├── variants.ts    # Component Variants
│               ├── events.ts      # 事件监听
│               └── diff.ts        # Diff Engine
├── docs/
│   └── PLAN.md          # 项目规划文档
└── test-e2e.mjs         # 端到端测试
```

## Semantic Tools 参考

### 读取类

| Tool | 说明 |
|------|------|
| `get_document_info` | 获取文档名称、页面列表 |
| `get_node_tree` | 递归获取节点层级 |
| `get_node_properties` | 获取节点属性 |
| `find_nodes` | 按名称/类型/语义搜索 |
| `get_styles` | 获取样式信息 |
| `get_semantic_map` | 获取语义注册表 |

### 创建类 — 基础

| Tool | 说明 |
|------|------|
| `create_container` | 容器（Frame + Auto Layout） |
| `create_text` | 文本节点 |

### 创建类 — UI 组件

| Tool | 说明 |
|------|------|
| `create_button` | 按钮（primary/secondary/ghost） |
| `create_card` | 卡片（default/outlined/elevated） |
| `create_input` | 输入框 |
| `create_avatar` | 头像 |
| `create_icon` | 图标 |
| `create_image` | 图片占位 |
| `create_divider` | 分割线 |
| `create_badge` | 徽标 |

### 创建类 — 布局组件

| Tool | 说明 |
|------|------|
| `create_header` | 页头 |
| `create_sidebar` | 侧边栏 |
| `create_grid` | 网格布局 |
| `create_list` | 列表 |
| `create_form` | 表单 |
| `create_modal` | 弹窗 |
| `create_toast` | 提示条 |
| `create_navigation` | 导航栏 |
| `create_hero` | Hero 区域 |

### 修改类

| Tool | 说明 |
|------|------|
| `update_node` | 更新节点属性 |
| `update_by_semantic` | 按语义批量更新 |
| `delete_node` | 删除节点 |
| `delete_by_semantic` | 按语义批量删除 |
| `move_node` | 移动/重排节点 |
| `reorder_by_semantic` | 按语义重排 |

### 导出类

| Tool | 说明 |
|------|------|
| `export_node` | 导出节点为图片 |
| `export_by_semantic` | 按语义批量导出 |

### Variables（设计 Token）

| Tool | 说明 |
|------|------|
| `create_variable_collection` | 创建变量集合（支持多模式） |
| `get_variable_collections` | 获取所有变量集合 |
| `create_variable` | 创建变量 |
| `get_variables` | 获取变量列表 |
| `update_variable` | 更新变量值 |
| `delete_variable` | 删除变量 |

### Component Variants

| Tool | 说明 |
|------|------|
| `create_component_set` | 创建组件变体集 |
| `get_component_sets` | 获取所有变体集 |
| `create_variant_instance` | 通过变体属性创建实例 |
| `update_variant` | 更新变体属性 |

### Event Listeners

| Tool | 说明 |
|------|------|
| `start_event_listener` | 开始监听文档事件 |
| `stop_event_listener` | 停止监听 |
| `get_pending_events` | 获取待处理事件 |

### Diff Engine & Template

| Tool | 说明 |
|------|------|
| `diff_snapshot` | 获取节点树快照 |
| `diff_apply` | 增量更新（只发送变化部分） |
| `create_from_template` | 从模板创建 |
| `list_templates` | 列出可用模板 |
| `save_as_template` | 保存为模板 |

### 系统

| Tool | 说明 |
|------|------|
| `batch_execute` | 批量执行（支持 rollback） |

## REST API

Bridge Server 同时提供 HTTP 接口：

```bash
# 健康检查
curl http://localhost:37850/health

# 调用工具
curl -X POST http://localhost:37850/tools/get_document_info

# 创建容器
curl -X POST http://localhost:37850/tools/create_container \
  -H "Content-Type: application/json" \
  -d '{"name": "my-frame", "direction": "VERTICAL", "padding": 16}'
```

## 开发

```bash
# 构建所有包
pnpm build

# 运行端到端测试
node test-e2e.mjs

# 开发模式启动 Bridge
pnpm dev:bridge
```

## 技术栈

| 层级 | 技术 |
|------|------|
| Plugin | TypeScript + Figma Plugin API |
| Bridge | TypeScript + Node.js |
| MCP SDK | `@modelcontextprotocol/sdk` |
| WebSocket | `ws` |
| 构建 | esbuild + tsc |
| 包管理 | pnpm (monorepo) |
