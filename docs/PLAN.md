# Figma Automation Platform — 项目规划

> 通过 Figma Plugin API + Bridge Server + MCP 协议，实现 Claude Code 对 Figma 的完整读写操控。

---

## 一、项目定位

### 要解决的问题

| 痛点 | 现状 | 目标 |
|------|------|------|
| 官方 Figma MCP 限流严重 | 120 req/min，复杂文件频繁 429 | Plugin API 无调用次数限制 |
| 只能读不能写 | REST API 单向 | 完整的创建/修改/删除能力 |
| 每次调用都走网络 | 高延迟、易超时 | WebSocket 本地通信，毫秒级响应 |
| 无法自动化设计流程 | 手动操作 Figma | AI 驱动的批量设计操作 |

### 目标用户

- 需要 AI 辅助 Figma 设计的设计师/开发者
- 需要批量生成 Figma 设计资源的团队（如多规格物料、组件变体）
- 建筑装饰行业：施工图标注、材料分布表、方案快速出图

---

## 二、核心设计原则

### 原则一：AI 表达意图，Bridge 负责实现

AI 不应该直接调用 Plugin API（`createFrame`、`setPadding`、`setFont`），而应该调用语义化的高级工具（`create_card`、`create_button`、`create_sidebar`）。底层 API 编排由 Bridge 内部完成。

```
❌ 错误方式：
Claude → create_frame() → set_size() → set_padding() → create_text() → set_font() → set_fill()
         （几十次 Tool Call，AI 在做 Bridge 该做的事）

✅ 正确方式：
Claude → create_card({ title: "User Profile", variant: "horizontal" })
         （1 次 Tool Call，Bridge 内部完成所有底层操作）
```

### 原则二：两层能力架构

系统采用两层能力架构，底层对 AI 不可见：

```
┌─────────────────────────────────────────────────┐
│  Semantic Layer（语义层）— AI 调用的 MCP Tools    │
│                                                   │
│  create_button / create_card / create_sidebar     │
│  update_card / delete_all_buttons / find_cards    │
│                                                   │
│  Bridge 实现，对 AI 暴露                           │
├─────────────────────────────────────────────────┤
│  Primitive Layer（原语层）— Bridge 内部使用       │
│                                                   │
│  createNode / deleteNode / setProperties          │
│  moveNode / batchExecute                          │
│                                                   │
│  不暴露给 AI，仅 Bridge 内部编排                   │
├─────────────────────────────────────────────────┤
│  Figma Plugin API — Plugin 端执行                 │
│                                                   │
│  figma.createFrame / figma.createText / etc.      │
└─────────────────────────────────────────────────┘
```

### 原则三：语义注册表

Bridge 维护一个轻量的 **Semantic Registry**，在创建节点时由 AI 显式声明语义标签。后续操作可以通过语义标签定位节点，而非手动分析节点树。

```typescript
// 创建时声明语义
create_card({ name: "user-card", semantic: "card", layout: "horizontal" })

// 后续操作通过语义定位
find_nodes({ semantic: "card" })           // 找到所有卡片
update_card({ target: "user-card", ... })  // 按名称定位
```

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Figma Desktop / Web                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Figma Plugin (figma-bridge)                    │  │
│  │                                                                   │  │
│  │  ┌──────────────┐    postMessage    ┌──────────────────────────┐  │  │
│  │  │  code.js     │ ◄════════════════► │  ui.html (iframe)       │  │  │
│  │  │  (Main)      │                    │  WebSocket Client       │  │  │
│  │  │              │                    └──────────┬───────────────┘  │  │
│  │  │  figma.* API │                               │                  │  │
│  │  │  原子操作执行  │                               │                  │  │
│  │  └──────────────┘                               │                  │  │
│  └─────────────────────────────────────────────────┼──────────────────┘  │
└────────────────────────────────────────────────────┼─────────────────────┘
                                                     │ WebSocket
                                                     │ (localhost)
┌────────────────────────────────────────────────────┼─────────────────────┐
│                     Bridge Server (Node.js)         │                     │
│                                                     ▼                     │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                     Semantic Layer                               │    │
│  │                                                                  │    │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐             │    │
│  │  │ create_card │ │ create_button│ │ create_sidebar│  ...        │    │
│  │  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘             │    │
│  │         │               │                │                       │    │
│  │         ▼               ▼                ▼                       │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │              Primitive Layer（内部编排）                   │   │    │
│  │  │                                                          │   │    │
│  │  │  一个 Semantic Tool → 多个 Primitive Commands             │   │    │
│  │  │  create_card → createFrame + setLayout + createText ...  │   │    │
│  │  └──────────────────────────┬───────────────────────────────┘   │    │
│  │                             │                                    │    │
│  │  ┌──────────────────────────▼───────────────────────────────┐   │    │
│  │  │              Semantic Registry（语义注册表）               │   │    │
│  │  │                                                          │   │    │
│  │  │  nodeId → { type: "card", name: "user-card", ... }       │   │    │
│  │  │  支持按语义类型/名称查询、过滤                             │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│  ┌───────────────────────────▼─────────────────────────────────────┐    │
│  │                    Command Router                                │    │
│  │  接收 Primitive Commands → 路由到 Plugin → 等待结果 → 返回响应   │    │
│  └───────────────────────────┬─────────────────────────────────────┘    │
│                              │                                           │
│  ┌────────────────────┐  ┌───▼────────────────────┐  ┌──────────────┐  │
│  │  WebSocket Server │  │  MCP Server (stdio)     │  │  Cache Layer │  │
│  │  端口: 37849       │  │  Claude Code 通过       │  │  节点缓存     │  │
│  │  连接 Plugin       │  │  stdin/stdout 调用      │  │  TTL 可配置   │  │
│  └────────────────────┘  └────────────────────────┘  └──────────────┘  │
│                                                                         │
│  ┌────────────────────┐  ┌────────────────────────┐  ┌──────────────┐  │
│  │  Command Queue     │  │  Event Bus              │  │ Config Manager│  │
│  │  命令排队 + 超时    │  │  连接状态 / 错误事件    │  │ 端口/超时/日志│  │
│  └────────────────────┘  └────────────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               │ MCP Protocol (stdio)
                               ▼
                    ┌─────────────────────────┐
                    │      Claude Code        │
                    │                         │
                    │  调用 Semantic Tools     │
                    │  表达设计意图            │
                    └─────────────────────────┘
```

### 通信链路

```
Claude Code                    Bridge Server                    Figma Plugin
    │                              │                                │
    │── create_card({...}) ───────▶│                                │
    │                              │  Semantic Layer 解析参数        │
    │                              │  编排 Primitive Commands:       │
    │                              │                                │
    │                              │── createFrame ────────────────▶│ (WebSocket)
    │                              │── setLayout ──────────────────▶│
    │                              │── createText ─────────────────▶│
    │                              │── setFills ───────────────────▶│
    │                              │                                │
    │                              │  Semantic Registry 注册节点    │
    │                              │                                │
    │◀── { card: { id, ... } } ───│                                │
    │                              │                                │
    │   1 次 Tool Call → 4 次内部命令，AI 只看到结果                  │
```

---

## 四、能力分层定义

### 第一层：Semantic Tools（语义工具）— 对 AI 暴露

这是 AI 唯一看到的工具集。每个工具对应一个设计语义概念，Bridge 负责将语义操作翻译为多个底层 API 调用。

#### 读取类

| Tool | 说明 | 参数示例 |
|------|------|----------|
| `get_document_info` | 获取文档名称、页面列表 | — |
| `get_node_tree` | 递归获取节点层级 | `{ nodeId?, depth? }` |
| `get_node_properties` | 获取节点属性 | `{ nodeId, properties? }` |
| `find_nodes` | 按名称/类型/语义标签搜索 | `{ name?, type?, semantic? }` |
| `get_styles` | 获取样式信息 | `{ nodeId? }` |
| `get_semantic_map` | 获取语义注册表 | `{ filter? }` |

#### 创建类

| Tool | 说明 | 核心参数 |
|------|------|----------|
| `create_container` | 创建容器（Frame + Auto Layout） | `{ name, direction, padding, gap, fill?, cornerRadius? }` |
| `create_button` | 创建按钮 | `{ name, label, variant?, size?, icon? }` |
| `create_card` | 创建卡片 | `{ name, title, description?, variant?, layout? }` |
| `create_text` | 创建文本节点 | `{ name, content, fontSize?, fontWeight?, color? }` |
| `create_input` | 创建输入框 | `{ name, placeholder?, label?, type? }` |
| `create_avatar` | 创建头像 | `{ name, size?, shape?, imageUrl? }` |
| `create_icon` | 创建图标 | `{ name, icon?, size?, color? }` |
| `create_image` | 创建图片占位 | `{ name, width, height, src? }` |
| `create_divider` | 创建分割线 | `{ name, direction?, thickness?, color? }` |
| `create_badge` | 创建徽标/标签 | `{ name, label, variant?, color? }` |

#### 布局类

| Tool | 说明 | 核心参数 |
|------|------|----------|
| `create_header` | 创建页头 | `{ name, title, subtitle?, actions? }` |
| `create_sidebar` | 创建侧边栏 | `{ name, items?, width? }` |
| `create_grid` | 创建网格布局 | `{ name, columns, rows?, gap? }` |
| `create_list` | 创建列表 | `{ name, items?, direction? }` |
| `create_form` | 创建表单 | `{ name, fields: Array<{type, label, placeholder?}> }` |
| `create_modal` | 创建弹窗/对话框 | `{ name, title, content? }` |
| `create_toast` | 创建提示条 | `{ name, message, variant? }` |
| `create_navigation` | 创建导航栏 | `{ name, items: Array<{label, icon?}> }` |
| `create_hero` | 创建 Hero 区域 | `{ name, title, subtitle, cta? }` |

#### 修改类

| Tool | 说明 | 核心参数 |
|------|------|----------|
| `update_node` | 更新节点属性 | `{ nodeId, properties }` |
| `update_by_semantic` | 按语义标签批量更新 | `{ semantic, properties, filter? }` |
| `delete_node` | 删除节点 | `{ nodeId }` |
| `delete_by_semantic` | 按语义标签批量删除 | `{ semantic, filter? }` |
| `move_node` | 移动/重排节点 | `{ nodeId, parentId?, index? }` |
| `reorder_by_semantic` | 按语义重排 | `{ semantic, order: string[] }` |

#### 导出类

| Tool | 说明 | 核心参数 |
|------|------|----------|
| `export_node` | 导出节点为图片 | `{ nodeId, format?, scale? }` |
| `export_by_semantic` | 按语义批量导出 | `{ semantic, format?, scale?, outputDir? }` |

#### 系统类

| Tool | 说明 | 参数 |
|------|------|------|
| `get_connection_status` | 获取 Plugin 连接状态 | — |
| `batch_execute` | 批量执行多个操作 | `{ commands: Array<{tool, params}> }` |

### 第二层：Primitive Commands（原语命令）— Bridge 内部使用

这一层不暴露给 AI，仅在 Bridge 内部由 Semantic Tools 编排调用。

| Command | 说明 |
|---------|------|
| `createNode` | 创建基础节点（Frame/Rectangle/Ellipse/Text/Line） |
| `deleteNode` | 删除单个节点 |
| `setProperties` | 设置节点属性（位置、尺寸、填充、描边等） |
| `setLayout` | 设置 Auto Layout 属性 |
| `createTextNode` | 创建文本节点并加载字体 |
| `batchCreate` | 批量创建多个节点 |
| `batchSetProperties` | 批量设置属性 |
| `moveNode` | 移动节点到指定父节点 |
| `exportNode` | 导出节点为图片 |

---

## 五、语义注册表（Semantic Registry）

### 设计理念

Bridge 维护一个内存中的语义注册表，记录每个节点的语义信息。这个注册表在节点创建时由 AI 显式声明，不做自动推断。

### 数据结构

```typescript
interface SemanticEntry {
  nodeId: string;           // Figma 节点 ID
  type: string;             // 语义类型：card, button, sidebar...
  name: string;             // AI 声明的名称：user-card, submit-btn...
  createdAt: number;        // 创建时间戳
  parentId?: string;        // 父节点 ID
  metadata?: Record<string, any>;  // AI 附加的元数据
}

// Bridge 内部存储
const registry: Map<string, SemanticEntry> = new Map();
// key = nodeId
```

### 使用方式

```typescript
// 1. 创建时自动注册（Bridge 内部）
const result = await create_card({ name: "user-card", title: "User Profile" });
// Bridge 创建完节点后自动：
registry.set(result.nodeId, {
  nodeId: result.nodeId,
  type: "card",
  name: "user-card",
  createdAt: Date.now(),
  parentId: result.parentId
});

// 2. 通过语义查询
find_nodes({ semantic: "card" })
// → 返回所有 type === "card" 的节点

// 3. 通过名称定位
find_nodes({ semantic: "card", name: "user-card" })
// → 返回 name === "user-card" 的节点

// 4. 批量操作
delete_by_semantic({ semantic: "button", filter: "submit-*" })
// → 删除所有 name 匹配 "submit-*" 的按钮

// 5. 获取完整语义图
get_semantic_map()
// → 返回所有注册的语义节点，用于 AI 理解当前设计结构
```

### 生命周期

- **创建时**：Semantic Tool 执行完毕后自动注册
- **更新时**：`update_node` 不改变语义信息
- **删除时**：`delete_node` / `delete_by_semantic` 自动从注册表移除
- **持久化**：不持久化。Plugin 重启后注册表清空，AI 可通过 `get_node_tree` 重新扫描并重建

---

## 六、功能需求（Feature List）

### P0 — 核心能力（MVP 必须）

| ID | 功能 | 说明 | 层级 |
|----|------|------|------|
| F-01 | 文档信息获取 | 获取文档名称、页面列表 | Semantic |
| F-02 | 节点树遍历 | 递归获取节点层级，支持深度控制 | Semantic |
| F-03 | 节点属性读取 | 获取节点位置、尺寸、填充、样式 | Semantic |
| F-04 | 节点搜索 | 按名称/类型/语义标签搜索 | Semantic |
| F-05 | 创建容器 | Frame + Auto Layout，支持方向/间距/内边距 | Semantic |
| F-06 | 创建文本 | 文本节点，支持字体/字号/颜色 | Semantic |
| F-07 | 创建基础图形 | 矩形/圆角/椭圆/线条 | Semantic |
| F-08 | 修改节点属性 | 批量修改已有节点属性 | Semantic |
| F-09 | 删除节点 | 删除指定节点及其子节点 | Semantic |
| F-10 | Bridge Server 基础框架 | WebSocket Server + MCP Server + 命令路由 | Infrastructure |
| F-11 | Plugin 基础框架 | Plugin main + iframe + WebSocket 客户端 | Infrastructure |
| F-12 | 连接管理 | 连接建立、断开重连、状态指示 | Infrastructure |
| F-13 | Semantic Registry | 语义注册表（内存 Map，创建时注册） | Infrastructure |

### P1 — 进阶能力（第二阶段）

| ID | 功能 | 说明 | 层级 |
|----|------|------|------|
| F-14 | 语义化 UI 组件 | button/card/input/avatar/icon/image/badge | Semantic |
| F-15 | 语义化布局组件 | header/sidebar/grid/list/form/modal/navigation/hero | Semantic |
| F-16 | 语义化批量操作 | 按语义标签查询/更新/删除/重排 | Semantic |
| F-17 | 组件创建与实例化 | 创建 Component 并生成 Instance | Semantic |
| F-18 | 导出资源 | 节点导出为 PNG/JPG/SVG | Semantic |
| F-19 | 样式管理 | 读取/创建 Paint Styles、Text Styles | Semantic |
| F-20 | 图层管理 | 切换页面、锁定/隐藏节点、调整 Z-index | Semantic |
| F-21 | batch_execute | 一次调用执行多个 Semantic Tool | Semantic |
| F-22 | 插件 UI 状态面板 | 显示连接状态、操作日志、错误信息 | Infrastructure |

### P2 — 高级能力（第三阶段）

| ID | 功能 | 说明 | 层级 |
|----|------|------|------|
| F-23 | Variables/Token CRUD | 设计 Token 的完整读写管理 | Semantic |
| F-24 | Component Variants | 变体系统的创建和属性设置 | Semantic |
| F-25 | 事件监听 | 监听文档变化（节点选中、内容修改等） | Infrastructure |
| F-26 | Batch Command + 回滚 | 批量命令执行，失败时回滚已创建的节点 | Infrastructure |
| F-27 | Diff Engine | 对比当前状态与目标状态，只发送变化的属性 | Infrastructure |
| F-28 | 宏/模板系统 | 预定义设计模板，参数化生成 | Semantic |
| F-29 | REST API 接口 | 除 MCP 外额外暴露 HTTP API | Infrastructure |

---

## 七、技术选型

| 层级 | 技术 | 理由 |
|------|------|------|
| Plugin Main | TypeScript | Figma Plugin API 原生支持 |
| Plugin UI | HTML + TypeScript | iframe 通信 + WebSocket |
| Bridge Server | TypeScript + Node.js | MCP SDK 官方支持 TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` | Anthropic 官方 MCP SDK |
| WebSocket | `ws` (npm) | 轻量、成熟、无需额外依赖 |
| 构建工具 | esbuild / tsup | 快速构建，输出 ESM |
| 包管理 | pnpm | 快速、节省磁盘 |
| 测试 | Vitest | 快速单元测试 |
| 调试 | Figma Plugin 原生调试 + VS Code | 双端调试 |

---

## 八、项目结构

```
figma-automation-platform/
├── docs/
│   └── PLAN.md                  # 本文件
├── packages/
│   ├── plugin/                  # Figma Plugin
│   │   ├── manifest.json
│   │   ├── src/
│   │   │   ├── code.ts          # Plugin Main（figma.* API）
│   │   │   ├── ui.ts            # iframe 逻辑（WebSocket 客户端）
│   │   │   ├── types.ts         # 命令/响应类型定义
│   │   │   ├── commands/        # Primitive Command 处理器
│   │   │   │   ├── read.ts      # 读取原语
│   │   │   │   ├── create.ts    # 创建原语
│   │   │   │   ├── modify.ts    # 修改原语
│   │   │   │   └── export.ts    # 导出原语
│   │   │   └── utils/
│   │   │       ├── serialize.ts # 节点序列化工具
│   │   │       ├── color.ts     # 颜色转换（hex ↔ RGB 0-1）
│   │   │       └── font.ts      # 字体加载辅助
│   │   ├── ui.html
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── bridge/                  # Bridge Server
│   │   ├── src/
│   │   │   ├── index.ts         # 入口，启动 WS + MCP
│   │   │   ├── ws-server.ts     # WebSocket Server
│   │   │   ├── mcp-server.ts    # MCP Server + Semantic Tool 定义
│   │   │   ├── command-router.ts # Primitive Command 路由 + 超时
│   │   │   ├── semantic/        # ← 新增：Semantic Layer
│   │   │   │   ├── registry.ts  # 语义注册表
│   │   │   │   ├── tools.ts     # Semantic Tool 定义与实现
│   │   │   │   ├── primitives.ts # Primitive Command 封装（内部 API）
│   │   │   │   └── types.ts     # 语义相关类型
│   │   │   ├── cache.ts         # 缓存层
│   │   │   ├── config.ts        # 配置管理
│   │   │   └── types.ts         # 类型定义
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                  # 共享类型
│       ├── src/
│       │   └── types.ts         # 命令、响应、错误的统一类型
│       ├── package.json
│       └── tsconfig.json
│
├── package.json                 # monorepo 根配置
├── pnpm-workspace.yaml
├── .gitignore
└── README.md
```

### 关键目录说明

```
packages/bridge/src/semantic/
├── registry.ts      # SemanticRegistry 类：内存 Map，CRUD + 查询
├── tools.ts         # 所有 Semantic Tool 的注册和实现
├── primitives.ts    # Primitive Command 封装：createNode, setProperties...
└── types.ts         # SemanticEntry, ToolDefinition 等类型
```

`tools.ts` 是核心文件——每个 Semantic Tool 在这里定义参数 schema 和实现逻辑。例如 `create_card` 的实现会调用 `primitives.ts` 中的 `createNode`、`setLayout`、`createTextNode` 等原语。

---

## 九、阶段性计划

### Phase 1 — 骨架搭建（目标：跑通最小链路）✅ 已完成

**周期：3-4 天**

**交付物：** 一个能连通 Claude Code → Bridge Server → Figma Plugin 的最小可用系统，且从第一版开始就使用 Semantic Tools。

| 任务 | 内容 | 产出 | 状态 |
|------|------|------|------|
| T-01 | Monorepo 项目初始化 | pnpm workspace + TypeScript 配置 | ✅ |
| T-02 | 共享类型定义 | 命令/响应/错误的 TypeScript 类型 | ✅ |
| T-03 | Plugin 基础框架 | manifest.json + code.js + ui.html，能装进 Figma | ✅ |
| T-04 | WebSocket 通信层 | Plugin ↔ Bridge 的双向通信 | ✅ |
| T-05 | Bridge Server 骨架 | WebSocket Server + MCP Server + 命令路由 | ✅ |
| T-06 | Primitive Layer 封装 | `primitives.ts`：createNode, setProperties, createTextNode | ✅ |
| T-07 | Semantic Registry 基础 | `registry.ts`：内存 Map + 注册/查询/删除 | ✅ |
| T-08 | 3 个 Semantic Tools 实现 | `get_document_info` + `create_container` + `create_text` | ✅ |
| T-09 | 端到端验证 | Claude Code 通过 MCP 读取文档并创建带文本的 Frame | ✅ |

**验收标准：**
- [x] 在 Figma 中打开 Plugin，看到 "已连接" 状态
- [x] Claude Code 调用 `get_document_info` 返回正确结果
- [x] Claude Code 调用 `create_container` + `create_text` 创建一个带标题的容器
- [x] `get_semantic_map` 返回刚创建的节点语义信息
- [x] 整个链路延迟 < 500ms

---

### Phase 2 — 核心能力补全（目标：满足 80% 日常需求）✅ 已完成

**周期：7-10 天**

**交付物：** 完整的 Semantic Tool 集合，覆盖容器、文本、基础图形、UI 组件、布局组件。

| 任务 | 内容 | 产出 | 状态 |
|------|------|------|------|
| T-10 | 基础创建 Semantic Tools | `create_button`, `create_card`, `create_input`, `create_avatar`, `create_icon`, `create_image`, `create_divider`, `create_badge` | ✅ |
| T-11 | 布局 Semantic Tools | `create_header`, `create_sidebar`, `create_grid`, `create_list`, `create_form`, `create_modal`, `create_toast`, `create_navigation`, `create_hero` | ✅ |
| T-12 | 读取 Semantic Tools | `get_node_properties`, `find_nodes`, `get_styles`, `get_semantic_map` | ✅ |
| T-13 | 修改 Semantic Tools | `update_node`, `update_by_semantic`, `delete_node`, `delete_by_semantic`, `move_node`, `reorder_by_semantic` | ✅ |
| T-14 | 导出 Semantic Tools | `export_node`, `export_by_semantic` | ✅ |
| T-15 | 批量执行 | `batch_execute`（一次调用多个 Semantic Tool） | ✅ |
| T-16 | 错误处理完善 | 字体加载失败、节点不存在、连接断开等异常处理 | ✅ |
| T-17 | 缓存层实现 | 基于节点 ID + 文件版本的内存缓存 | ⏳ 延后 |
| T-18 | Plugin UI 状态面板 | 显示连接状态、命令计数、最近操作 | ⏳ 延后 |

**验收标准：**
- [x] 能通过 Claude Code 用 1-2 次 Tool Call 创建一个完整的卡片组件
- [x] 能用 `create_header` + `create_sidebar` + `create_grid` 组合出一个页面布局
- [x] 能通过语义标签搜索和批量更新节点
- [x] 能导出节点为 PNG/SVG
- [x] 错误场景有清晰的提示信息

---

### Phase 3 — 高级特性（目标：专业级自动化平台）✅ 已完成

**周期：7-10 天**

**交付物：** 支持 Token 管理、事件监听、批量回滚、Diff Engine 的完整平台。当前共 **52 个 Semantic Tools**。

| 任务 | 内容 | 产出 | 状态 |
|------|------|------|------|
| T-19 | Variables CRUD | 设计 Token 的创建、读取、修改、删除（6 个工具） | ✅ |
| T-20 | Component Variants | 变体系统的完整支持（4 个工具） | ✅ |
| T-21 | 事件监听机制 | 文档变化的实时通知（3 个工具） | ✅ |
| T-22 | Batch Command + 回滚 | 批量命令执行，任一失败则回滚已创建的节点 | ✅ |
| T-23 | Diff Engine | 对比当前状态与目标状态，只发送变化的属性（2 个工具） | ✅ |
| T-24 | 模板/宏系统 | 预定义布局模板，参数化生成（3 个工具） | ✅ |
| T-25 | REST API 接口 | HTTP API 作为 MCP 的补充（端口 37850） | ✅ |
| T-26 | 文档与示例 | README.md + API 参考 + 更新 PLAN.md | ✅ |

**验收标准：**
- [x] 能管理设计 Token（创建颜色变量、应用到节点）
- [x] 批量创建节点，中途失败，验证回滚正确
- [x] 能使用 `diff_snapshot` + `diff_apply` 做增量更新
- [x] 能使用模板快速生成标准页面布局
- [x] 有完整的使用文档（README.md）

**新增文件：**
- `packages/plugin/src/commands/variables.ts` — Variables 命令处理器
- `packages/plugin/src/commands/variants.ts` — Component Variants 命令处理器
- `packages/plugin/src/commands/events.ts` — Event Listener 命令处理器
- `packages/plugin/src/commands/diff.ts` — Diff Engine 命令处理器
- `packages/bridge/src/semantic/templates.ts` — Template Registry
- `packages/bridge/src/http-server.ts` — REST API Server
- `README.md` — 项目文档

---

### Phase 4 — 打磨与生态（目标：可分发、可扩展）

**周期：持续**

| 方向 | 内容 |
|------|------|
| NPM 发布 | `@figma-bridge/plugin` + `@figma-bridge/server` |
| 一键安装 | `npx figma-bridge setup` 自动安装 Plugin + 配置 MCP |
| 社区模板 | 常用设计模式的模板库 |
| 更多 AI 工具适配 | Cursor、Windsurf、Copilot 等 MCP 客户端兼容 |
| CI/CD 集成 | 无头模式的自动化流水线 |

---

## 十、里程碑时间线

```
Week 1-2    Phase 1: 骨架搭建 ✅
            └── ▲ v0.1.0-alpha 跑通最小链路（Semantic Tools 从第一版开始）

Week 3-5    Phase 2: 核心能力 ✅
            └── ▲ v0.2.0-beta 完整 Semantic Tool 集合（30 个工具）

Week 6-8    Phase 3: 高级特性 ✅
            └── ▲ v1.0.0 正式版（52 个工具，含 Variables、Variants、Events、Diff、Templates、REST API）

Week 9+     Phase 4: 打磨与生态
            └── ▲ 持续迭代
```

---

## 十一、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Plugin UI iframe 网络请求被限制 | 无法建立 WebSocket | 测试验证；备选方案用 long-polling |
| Figma Plugin API 变更 | Primitive Commands 失效 | 版本锁定 + 监听 Figma 更新日志 |
| 字体/资源加载延迟 | 大量文本操作时变慢 | 字体预加载 + 批量操作合并 |
| Plugin 必须手动安装 | 用户门槛 | 提供安装引导 + 一键配置脚本 |
| Figma 桌面端 vs Web 端差异 | 行为不一致 | 优先支持桌面端，Web 端作为兼容 |
| Semantic Tool 设计不合理 | AI 使用体验差 | 先实现 3-5 个核心工具，收集反馈后迭代 |
| 语义注册表丢失（Plugin 重启） | AI 无法按语义定位节点 | 提供 `rebuild_semantic_map` 工具，扫描节点树重建 |

---

## 十二、成功指标

| 指标 | 目标 |
|------|------|
| 端到端命令延迟 | < 200ms（单命令） |
| Semantic Tool 延迟 | < 500ms（单工具，含内部多次 Primitive 调用） |
| 批量操作吞吐 | > 50 个节点/秒 |
| 连接稳定性 | 99%+ 在线率（Plugin 打开期间） |
| Claude Code 集成体验 | 自然语言描述 → Figma 设计稿，< 30 秒完成 |
| Tool Call 效率 | 创建一个完整卡片：≤ 2 次 Tool Call（vs 原方案 10+ 次） |

---

## 附录：Semantic Tool 设计示例

### `create_card` 工具定义

```typescript
// packages/bridge/src/semantic/tools.ts

{
  name: "create_card",
  description: "创建一个卡片组件，包含标题、描述、可选的操作按钮",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "卡片名称（用于语义注册）" },
      title: { type: "string", description: "卡片标题" },
      description: { type: "string", description: "卡片描述文字" },
      variant: {
        type: "string",
        enum: ["default", "outlined", "elevated"],
        default: "default"
      },
      layout: {
        type: "string",
        enum: ["vertical", "horizontal"],
        default: "vertical"
      },
      width: { type: "number", description: "卡片宽度（px）" },
      actions: {
        type: "array",
        items: { type: "string" },
        description: "操作按钮文字列表"
      },
      parentId: { type: "string", description: "父节点 ID（不传则创建在当前页面）" }
    },
    required: ["name", "title"]
  }
}
```

### `create_card` 实现逻辑（Bridge 内部）

```typescript
// packages/bridge/src/semantic/tools.ts

async function createCard(params: CreateCardParams): Promise<SemanticResult> {
  const { name, title, description, variant, layout, width, actions, parentId } = params;

  // 1. 创建外层容器
  const card = await primitives.createNode({
    type: "FRAME",
    name: `card-${name}`,
    parent: parentId,
    layout: layout === "horizontal" ? "HORIZONTAL" : "VERTICAL",
    padding: 16,
    gap: 12,
    cornerRadius: variant === "outlined" ? 0 : 8,
    fills: variant === "elevated"
      ? [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }]
      : [],
    strokes: variant === "outlined"
      ? [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }]
      : [],
    width: width,
    effects: variant === "elevated"
      ? [{ type: "DROP_SHADOW", offset: { x: 0, y: 2 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.1 } }]
      : []
  });

  // 2. 创建标题
  await primitives.createTextNode({
    parent: card.id,
    content: title,
    fontSize: 16,
    fontWeight: "Bold",
    name: "card-title"
  });

  // 3. 创建描述（如果有）
  if (description) {
    await primitives.createTextNode({
      parent: card.id,
      content: description,
      fontSize: 14,
      fontWeight: "Regular",
      color: { r: 0.6, g: 0.6, b: 0.6 },
      name: "card-description"
    });
  }

  // 4. 创建操作按钮（如果有）
  if (actions && actions.length > 0) {
    const actionsContainer = await primitives.createNode({
      type: "FRAME",
      name: "card-actions",
      parent: card.id,
      layout: "HORIZONTAL",
      gap: 8
    });

    for (const actionText of actions) {
      // 内部调用 createButton 的逻辑
      await createButtonPrimitive({
        parent: actionsContainer.id,
        label: actionText,
        name: `btn-${actionText.toLowerCase()}`
      });
    }
  }

  // 5. 注册到语义表
  registry.set(card.id, {
    nodeId: card.id,
    type: "card",
    name: name,
    createdAt: Date.now(),
    parentId: parentId
  });

  return { nodeId: card.id, type: "card", name: name };
}
```

---

*最后更新：2026-07-13*
