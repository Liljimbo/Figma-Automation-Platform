// ============================================================
// @figma-forge/core — Semantic Tools 定义与实现
// AI 唯一看到的工具集
//
// 命名约定：
//   - MCP 工具名使用 snake_case（如 get_document_info, create_card）
//   - Plugin 命令使用 camelCase（如 getNodeTree, createNode）
// ============================================================

import type { SemanticToolDefinition, SemanticResult, PrimitiveExecutor } from './types.js';
import type { SemanticEntry } from './types.js';
import type { PluginEvent, StartListeningParams, NodeSnapshot, NodeDiff } from '@figma-forge/shared';
import { SemanticRegistry } from './registry.js';
import { Primitives } from './primitives.js';
import { TemplateRegistry } from './templates.js';

// ─── Utility ────────────────────────────────────────────────

/** Figma fill 类型 */
interface FigmaFill {
  type: 'SOLID' | 'IMAGE';
  color?: { r: number; g: number; b: number };
  opacity?: number;
  url?: string;
}

/** Figma stroke 类型 */
interface FigmaStroke {
  type: 'SOLID';
  color: { r: number; g: number; b: number };
}

/** Figma effect 类型 */
interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR';
  offset?: { x: number; y: number };
  radius?: number;
  color?: { r: number; g: number; b: number; a?: number };
  spread?: number;
  visible?: boolean;
  blendMode?: string;
}

/** 将 hex 颜色字符串转换为 Figma RGB 格式，支持 3 位和 6 位 hex */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** 解析 hex 颜色为 fills 数组 */
function parseFills(color?: string): FigmaFill[] {
  if (!color || typeof color !== 'string') return [];
  return [{ type: 'SOLID', color: hexToRgb(color), opacity: 1 }];
}

/** 解析 hex 颜色为 Figma 颜色对象 */
function parseColor(color?: string): { r: number; g: number; b: number; a?: number } | undefined {
  if (!color || typeof color !== 'string') return undefined;
  return { ...hexToRgb(color), a: 1 };
}

// ─── Tool Definitions（暴露给 MCP）────────────────────────

export const TOOL_DEFINITIONS: SemanticToolDefinition[] = [
  // ── 原有工具 ──
  {
    name: 'get_document_info',
    description: '获取当前 Figma 文档的基本信息，包括名称、ID 和所有页面列表',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_node_tree',
    description: '递归获取节点的层级结构树。不传 nodeId 则从当前页面根节点开始',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: '起始节点 ID（不传则从当前页面开始）',
        },
        depth: {
          type: 'number',
          description: '递归深度，默认 3',
        },
      },
    },
  },
  {
    name: 'create_container',
    description: '创建一个容器（Frame），支持 Auto Layout。用于包裹其他元素',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '容器名称（用于语义注册和后续查找）',
        },
        semantic: {
          type: 'string',
          description: '语义标签（如 "header", "sidebar", "card"）',
        },
        direction: {
          type: 'string',
          enum: ['HORIZONTAL', 'VERTICAL'],
          description: '布局方向',
        },
        padding: {
          type: 'number',
          description: '内边距（px）',
        },
        gap: {
          type: 'number',
          description: '子元素间距（px）',
        },
        width: {
          type: 'number',
          description: '宽度（px）',
        },
        height: {
          type: 'number',
          description: '高度（px）',
        },
        fill: {
          type: 'string',
          description: '背景颜色（hex 格式，如 #FFFFFF）',
        },
        cornerRadius: {
          type: 'number',
          description: '圆角半径（px）',
        },
        parentId: {
          type: 'string',
          description: '父节点 ID（不传则创建在当前页面）',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_text',
    description: '创建文本节点',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '文本内容',
        },
        name: {
          type: 'string',
          description: '节点名称（用于语义注册）',
        },
        semantic: {
          type: 'string',
          description: '语义标签',
        },
        fontSize: {
          type: 'number',
          description: '字体大小（px）',
        },
        fontWeight: {
          type: 'string',
          description: '字体粗细（如 "Regular", "Bold", "Semi Bold"）',
        },
        fontFamily: {
          type: 'string',
          description: '字体族（如 "Inter", "Roboto"）',
        },
        color: {
          type: 'string',
          description: '字体颜色（hex 格式，如 #333333）',
        },
        parentId: {
          type: 'string',
          description: '父节点 ID',
        },
      },
      required: ['content'],
    },
  },

  // ── UI 组件工具 ──
  {
    name: 'create_button',
    description: '创建按钮组件，支持 primary/secondary/ghost 样式和 sm/md/lg 尺寸',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '按钮名称' },
        label: { type: 'string', description: '按钮文字' },
        variant: { type: 'string', enum: ['primary', 'secondary', 'ghost'], description: '按钮样式', default: 'primary' },
        size: { type: 'string', enum: ['sm', 'md', 'lg'], description: '按钮尺寸', default: 'md' },
        icon: { type: 'string', description: '图标名称（可选）' },
        fill: { type: 'string', description: '背景颜色（hex，仅 primary 可用）' },
        textColor: { type: 'string', description: '文字颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'label'],
    },
  },
  {
    name: 'create_card',
    description: '创建卡片组件，支持 default/outlined/elevated 样式和 vertical/horizontal 布局',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '卡片名称' },
        title: { type: 'string', description: '卡片标题' },
        description: { type: 'string', description: '卡片描述' },
        variant: { type: 'string', enum: ['default', 'outlined', 'elevated'], description: '卡片样式', default: 'default' },
        layout: { type: 'string', enum: ['vertical', 'horizontal'], description: '布局方向', default: 'vertical' },
        actions: { type: 'array', items: { type: 'string' }, description: '操作按钮文字列表' },
        width: { type: 'number', description: '宽度（px）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_input',
    description: '创建输入框组件，支持 text/password/email 类型',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '输入框名称' },
        placeholder: { type: 'string', description: '占位符文字' },
        label: { type: 'string', description: '输入框标签' },
        type: { type: 'string', enum: ['text', 'password', 'email'], description: '输入类型', default: 'text' },
        width: { type: 'number', description: '宽度（px）', default: 320 },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_avatar',
    description: '创建头像组件，支持 circle/square 形状',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '头像名称' },
        size: { type: 'number', description: '尺寸（px）', default: 40 },
        shape: { type: 'string', enum: ['circle', 'square'], description: '形状', default: 'circle' },
        imageUrl: { type: 'string', description: '图片 URL' },
        fallbackText: { type: 'string', description: '无图片时显示的文字' },
        backgroundColor: { type: 'string', description: '背景颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_icon',
    description: '创建图标占位节点（使用文本模拟图标）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '图标名称' },
        icon: { type: 'string', description: '图标字符或标识' },
        size: { type: 'number', description: '尺寸（px）', default: 24 },
        color: { type: 'string', description: '图标颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'icon'],
    },
  },
  {
    name: 'create_image',
    description: '创建图片占位节点（Frame + IMAGE 填充或纯色占位）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '图片节点名称' },
        width: { type: 'number', description: '宽度（px）' },
        height: { type: 'number', description: '高度（px）' },
        src: { type: 'string', description: '图片 URL' },
        cornerRadius: { type: 'number', description: '圆角半径（px）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'width', 'height'],
    },
  },
  {
    name: 'create_divider',
    description: '创建分割线',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '分割线名称' },
        direction: { type: 'string', enum: ['horizontal', 'vertical'], description: '方向', default: 'horizontal' },
        length: { type: 'number', description: '长度（px）' },
        thickness: { type: 'number', description: '厚度（px）', default: 1 },
        color: { type: 'string', description: '颜色（hex）', default: '#E0E0E0' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_badge',
    description: '创建徽标/标签组件，支持 default/success/warning/error 样式',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '徽标名称' },
        label: { type: 'string', description: '徽标文字' },
        variant: { type: 'string', enum: ['default', 'success', 'warning', 'error'], description: '样式', default: 'default' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'label'],
    },
  },

  // ── 布局组件工具 ──
  {
    name: 'create_header',
    description: '创建页头组件，包含标题、副标题和操作按钮区域',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '页头名称' },
        title: { type: 'string', description: '标题' },
        subtitle: { type: 'string', description: '副标题' },
        actions: { type: 'array', items: { type: 'string' }, description: '操作按钮文字列表' },
        width: { type: 'number', description: '宽度（px）' },
        fill: { type: 'string', description: '背景颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_sidebar',
    description: '创建侧边栏组件，包含菜单项列表',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '侧边栏名称' },
        items: { type: 'array', items: { type: 'string' }, description: '菜单项文字列表' },
        width: { type: 'number', description: '宽度（px）', default: 240 },
        fill: { type: 'string', description: '背景颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_grid',
    description: '创建网格布局容器',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '网格名称' },
        columns: { type: 'number', description: '列数', default: 3 },
        rows: { type: 'number', description: '行数', default: 1 },
        gap: { type: 'number', description: '间距（px）', default: 16 },
        cellWidth: { type: 'number', description: '单元格宽度（px）' },
        cellHeight: { type: 'number', description: '单元格高度（px）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_list',
    description: '创建列表组件',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '列表名称' },
        items: { type: 'array', items: { type: 'string' }, description: '列表项文字' },
        direction: { type: 'string', enum: ['vertical', 'horizontal'], description: '方向', default: 'vertical' },
        gap: { type: 'number', description: '间距（px）', default: 0 },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_form',
    description: '创建表单组件，包含多个表单字段',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '表单名称' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: '字段类型（text/password/email/number）' },
              label: { type: 'string', description: '字段标签' },
              placeholder: { type: 'string', description: '占位符' },
            },
          },
          description: '表单字段定义列表',
        },
        width: { type: 'number', description: '宽度（px）', default: 400 },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_modal',
    description: '创建弹窗/对话框组件',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '弹窗名称' },
        title: { type: 'string', description: '弹窗标题' },
        content: { type: 'string', description: '弹窗内容文字' },
        width: { type: 'number', description: '宽度（px）', default: 480 },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'title'],
    },
  },
  {
    name: 'create_navigation',
    description: '创建导航栏组件',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '导航栏名称' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '导航项文字' },
              icon: { type: 'string', description: '导航项图标' },
            },
          },
          description: '导航项列表',
        },
        width: { type: 'number', description: '宽度（px）' },
        fill: { type: 'string', description: '背景颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_hero',
    description: '创建 Hero 区域组件，包含标题、副标题和 CTA 按钮',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Hero 区域名称' },
        title: { type: 'string', description: '主标题' },
        subtitle: { type: 'string', description: '副标题' },
        cta: { type: 'string', description: 'CTA 按钮文字' },
        width: { type: 'number', description: '宽度（px）' },
        height: { type: 'number', description: '高度（px）' },
        fill: { type: 'string', description: '背景颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'title'],
    },
  },
  {
    name: 'create_toast',
    description: '创建 Toast 提示条，支持 success/error/info/warning 样式',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '提示条名称' },
        message: { type: 'string', description: '提示文字' },
        variant: {
          type: 'string',
          enum: ['success', 'error', 'info', 'warning'],
          description: '样式变体',
          default: 'info',
        },
        width: { type: 'number', description: '宽度（px）' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'message'],
    },
  },

  // ── 读取工具 ──
  {
    name: 'find_nodes',
    description: '按名称、类型或语义标签搜索节点',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '名称匹配（支持 * 通配符）' },
        type: { type: 'string', description: '节点类型过滤（如 FRAME, TEXT, RECTANGLE）' },
        semantic: { type: 'string', description: '语义标签过滤（如 "button", "card"）' },
        recursive: { type: 'boolean', description: '是否递归搜索子节点', default: false },
        maxDepth: { type: 'number', description: '递归搜索最大深度' },
        propertyFilter: {
          type: 'object',
          description: '按属性值过滤',
        },
      },
    },
  },
  {
    name: 'get_node_properties',
    description: '获取指定节点的详细属性',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        properties: { type: 'array', items: { type: 'string' }, description: '要获取的属性列表（不传则返回全部）' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'get_styles',
    description: '获取节点的样式信息（填充、描边、效果等）',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'get_semantic_map',
    description: '获取语义注册表中的所有条目，支持按类型/名称过滤',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: '过滤条件',
          properties: {
            type: { type: 'string', description: '按类型过滤' },
            name: { type: 'string', description: '按名称过滤' },
            namePattern: { type: 'string', description: '按名称模式过滤（支持 * 通配符）' },
          },
        },
      },
    },
  },

  // ── 修改工具 ──
  {
    name: 'update_node',
    description: '更新指定节点的属性',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        properties: {
          type: 'object',
          description: '要更新的属性键值对（支持 name, visible, opacity, fills, strokes, cornerRadius 等）',
        },
      },
      required: ['nodeId', 'properties'],
    },
  },
  {
    name: 'update_by_semantic',
    description: '按语义标签批量更新节点属性',
    inputSchema: {
      type: 'object',
      properties: {
        semantic: { type: 'string', description: '语义标签' },
        properties: { type: 'object', description: '要更新的属性键值对' },
        filter: {
          type: 'object',
          description: '可选的额外过滤条件',
          properties: {
            type: { type: 'string', description: '按类型过滤' },
            name: { type: 'string', description: '按名称过滤' },
            namePattern: { type: 'string', description: '按名称模式过滤（支持 * 通配符）' },
          },
        },
      },
      required: ['semantic', 'properties'],
    },
  },
  {
    name: 'delete_node',
    description: '删除指定节点',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'delete_by_semantic',
    description: '按语义标签批量删除节点',
    inputSchema: {
      type: 'object',
      properties: {
        semantic: { type: 'string', description: '语义标签' },
        filter: {
          type: 'object',
          description: '可选的额外过滤条件',
          properties: {
            type: { type: 'string', description: '按类型过滤' },
            name: { type: 'string', description: '按名称过滤' },
            namePattern: { type: 'string', description: '按名称模式过滤（支持 * 通配符）' },
          },
        },
      },
      required: ['semantic'],
    },
  },
  {
    name: 'move_node',
    description: '移动节点到新的父节点下',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '要移动的节点 ID' },
        parentId: { type: 'string', description: '目标父节点 ID' },
        index: { type: 'number', description: '目标位置索引（不传则追加到末尾）' },
      },
      required: ['nodeId', 'parentId'],
    },
  },
  {
    name: 'reorder_by_semantic',
    description: '按语义标签重新排列同级节点的顺序',
    inputSchema: {
      type: 'object',
      properties: {
        semantic: { type: 'string', description: '语义标签' },
        order: { type: 'string', enum: ['asc', 'desc', 'name-asc', 'name-desc'], description: '排序方式', default: 'asc' },
      },
      required: ['semantic'],
    },
  },

  // ── 导出工具 ──
  {
    name: 'export_node',
    description: '导出指定节点为图片或 SVG/PDF',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        format: { type: 'string', enum: ['PNG', 'JPG', 'SVG', 'PDF'], description: '导出格式', default: 'PNG' },
        scale: { type: 'number', description: '缩放比例', default: 1 },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'export_by_semantic',
    description: '按语义标签批量导出节点',
    inputSchema: {
      type: 'object',
      properties: {
        semantic: { type: 'string', description: '语义标签' },
        format: { type: 'string', enum: ['PNG', 'JPG', 'SVG', 'PDF'], description: '导出格式', default: 'PNG' },
        scale: { type: 'number', description: '缩放比例', default: 1 },
        filter: {
          type: 'object',
          description: '可选的额外过滤条件',
          properties: {
            type: { type: 'string', description: '按类型过滤' },
            name: { type: 'string', description: '按名称过滤' },
            namePattern: { type: 'string', description: '按名称模式过滤（支持 * 通配符）' },
          },
        },
      },
      required: ['semantic'],
    },
  },

  // ── 系统工具 ──
  {
    name: 'batch_execute',
    description: '批量执行多个语义工具命令，按顺序依次执行。支持 rollback 模式：失败时自动回滚已创建的节点',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '工具名称' },
              params: { type: 'object', description: '工具参数' },
            },
          },
          description: '要执行的命令列表',
        },
        rollback: {
          type: 'boolean',
          description: '是否在失败时回滚已创建的节点',
          default: false,
        },
      },
      required: ['commands'],
    },
  },

  // ── Variables 工具 ──
  {
    name: 'create_variable_collection',
    description: '创建变量集合（设计 Token 分组），支持多个模式（如 light/dark）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '集合名称' },
        modes: {
          type: 'array',
          items: { type: 'string' },
          description: '模式列表，如 ["light", "dark"]，第一个为默认模式',
        },
      },
      required: ['name', 'modes'],
    },
  },
  {
    name: 'get_variable_collections',
    description: '获取所有变量集合（设计 Token 分组）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_variable',
    description: '创建设计变量（Token），支持 BOOLEAN/COLOR/FLOAT/STRING 类型',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '变量名称，如 "color/primary"' },
        collectionId: { type: 'string', description: '所属变量集合 ID' },
        resolvedType: {
          type: 'string',
          enum: ['BOOLEAN', 'COLOR', 'FLOAT', 'STRING'],
          description: '变量值类型',
        },
        valuesByMode: {
          type: 'object',
          description: '各模式下的值，key 为 modeId，value 为对应值',
        },
      },
      required: ['name', 'collectionId', 'resolvedType', 'valuesByMode'],
    },
  },
  {
    name: 'get_variables',
    description: '获取设计变量列表，可按类型和集合过滤',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['BOOLEAN', 'COLOR', 'FLOAT', 'STRING'],
          description: '按变量类型过滤',
        },
        collectionId: { type: 'string', description: '按集合 ID 过滤' },
      },
    },
  },
  {
    name: 'update_variable',
    description: '更新设计变量在指定模式下的值',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: '变量 ID' },
        modeId: { type: 'string', description: '模式 ID' },
        value: { type: 'string', description: '新值（类型需匹配变量的 resolvedType，COLOR 类型传 hex 字符串）' },
      },
      required: ['variableId', 'modeId', 'value'],
    },
  },
  {
    name: 'delete_variable',
    description: '删除设计变量',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: '要删除的变量 ID' },
      },
      required: ['variableId'],
    },
  },

  // ── Component Variants 工具 ──
  {
    name: 'create_component_set',
    description: '创建组件变体集，包含多个变体（如 Size=Small/Size=Large）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '组件集名称' },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '变体名称' },
              properties: { type: 'object', description: '变体属性，如 {"Size": "Large", "State": "Default"}' },
              width: { type: 'number', description: '宽度' },
              height: { type: 'number', description: '高度' },
            },
            required: ['name', 'properties'],
          },
          description: '变体列表',
        },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['name', 'variants'],
    },
  },
  {
    name: 'get_component_sets',
    description: '获取当前页面的所有组件变体集',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_variant_instance',
    description: '通过变体属性创建组件实例',
    inputSchema: {
      type: 'object',
      properties: {
        componentSetId: { type: 'string', description: '组件集 ID' },
        variantProperties: { type: 'object', description: '要匹配的变体属性，如 {"Size": "Large"}' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['componentSetId', 'variantProperties'],
    },
  },
  {
    name: 'update_variant',
    description: '更新组件变体的属性（重命名组件以反映新的变体属性）',
    inputSchema: {
      type: 'object',
      properties: {
        componentId: { type: 'string', description: '组件 ID' },
        properties: { type: 'object', description: '要更新的变体属性' },
      },
      required: ['componentId', 'properties'],
    },
  },

  // ── Event Listener 工具 ──
  {
    name: 'start_event_listener',
    description: '开始监听 Figma 文档事件（选区变化、文档变化、页面切换）',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: { type: 'string', enum: ['selectionchange', 'documentchange', 'currentpagechange'] },
          description: '要监听的事件类型',
        },
      },
      required: ['events'],
    },
  },
  {
    name: 'stop_event_listener',
    description: '停止监听文档事件',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: { type: 'string' },
          description: '要停止监听的事件类型，不传则停止所有',
        },
      },
    },
  },
  {
    name: 'get_pending_events',
    description: '获取待处理的文档事件（从上次查询以来的新事件）',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number', description: '只返回此时间戳之后的事件' },
      },
    },
  },

  // ── Diff Engine 工具 ──
  {
    name: 'diff_snapshot',
    description: '获取节点树的快照，用于后续对比和增量更新',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '根节点 ID，不传则使用当前页面' },
        depth: { type: 'number', description: '序列化深度，默认 10' },
      },
    },
  },
  {
    name: 'diff_apply',
    description: '对比当前状态与目标快照，只发送变化的属性（增量更新）',
    inputSchema: {
      type: 'object',
      properties: {
        targetSnapshot: {
          type: 'object',
          description: '目标快照（由 diff_snapshot 生成）',
        },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['targetSnapshot'],
    },
  },

  // ── Template 工具 ──
  {
    name: 'create_from_template',
    description: '从预定义模板创建设计，支持参数化',
    inputSchema: {
      type: 'object',
      properties: {
        templateName: { type: 'string', description: '模板名称' },
        parameters: { type: 'object', description: '模板参数' },
        parentId: { type: 'string', description: '父节点 ID' },
      },
      required: ['templateName'],
    },
  },
  {
    name: 'list_templates',
    description: '列出所有可用的设计模板',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'save_as_template',
    description: '将当前操作序列保存为可复用模板',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '模板名称' },
        description: { type: 'string', description: '模板描述' },
        tools: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              params: { type: 'object' },
            },
          },
          description: '工具调用序列',
        },
        parameters: {
          type: 'object',
          description: '参数定义（支持 ${paramName} 占位符）',
        },
      },
      required: ['name', 'description', 'tools'],
    },
  },
];

// ─── Tool Implementations ─────────────────────────────────

export class SemanticTools {
  private primitives: Primitives;
  private registry: SemanticRegistry;
  private eventQueue: PluginEvent[];
  private templateRegistry: TemplateRegistry;

  constructor(executor: PrimitiveExecutor, eventQueue: PluginEvent[] = []) {
    this.primitives = new Primitives(executor);
    this.registry = new SemanticRegistry();
    this.eventQueue = eventQueue;
    this.templateRegistry = new TemplateRegistry();
  }

  getRegistry(): SemanticRegistry {
    return this.registry;
  }

  /** 执行 Semantic Tool */
  async execute(toolName: string, params: Record<string, unknown>): Promise<SemanticResult> {
    try {
      switch (toolName) {
        // ── 原有工具 ──
        case 'get_document_info':
          return await this.getDocumentInfo();
        case 'get_node_tree':
          return await this.getNodeTree(params);
        case 'create_container':
          return await this.createContainer(params);
        case 'create_text':
          return await this.createText(params);

        // ── UI 组件工具 ──
        case 'create_button':
          return await this.createButton(params);
        case 'create_card':
          return await this.createCard(params);
        case 'create_input':
          return await this.createInput(params);
        case 'create_avatar':
          return await this.createAvatar(params);
        case 'create_icon':
          return await this.createIcon(params);
        case 'create_image':
          return await this.createImage(params);
        case 'create_divider':
          return await this.createDivider(params);
        case 'create_badge':
          return await this.createBadge(params);

        // ── 布局组件工具 ──
        case 'create_header':
          return await this.createHeader(params);
        case 'create_sidebar':
          return await this.createSidebar(params);
        case 'create_grid':
          return await this.createGrid(params);
        case 'create_list':
          return await this.createList(params);
        case 'create_form':
          return await this.createForm(params);
        case 'create_modal':
          return await this.createModal(params);
        case 'create_navigation':
          return await this.createNavigation(params);
        case 'create_hero':
          return await this.createHero(params);
        case 'create_toast':
          return await this.createToast(params);

        // ── 读取工具 ──
        case 'find_nodes':
          return await this.findNodes(params);
        case 'get_node_properties':
          return await this.getNodeProperties(params);
        case 'get_styles':
          return await this.getStyles(params);
        case 'get_semantic_map':
          return await this.getSemanticMap(params);

        // ── 修改工具 ──
        case 'update_node':
          return await this.updateNode(params);
        case 'update_by_semantic':
          return await this.updateBySemantic(params);
        case 'delete_node':
          return await this.deleteNode(params);
        case 'delete_by_semantic':
          return await this.deleteBySemantic(params);
        case 'move_node':
          return await this.moveNode(params);
        case 'reorder_by_semantic':
          return await this.reorderBySemantic(params);

        // ── 导出工具 ──
        case 'export_node':
          return await this.exportNode(params);
        case 'export_by_semantic':
          return await this.exportBySemantic(params);

        // ── 系统工具 ──
        case 'batch_execute':
          return await this.batchExecute(params);

        // ── Variables 工具 ──
        case 'create_variable_collection':
          return await this.createVariableCollection(params);
        case 'get_variable_collections':
          return await this.getVariableCollections();
        case 'create_variable':
          return await this.createVariable(params);
        case 'get_variables':
          return await this.getVariables(params);
        case 'update_variable':
          return await this.updateVariable(params);
        case 'delete_variable':
          return await this.deleteVariable(params);

        // ── Component Variants 工具 ──
        case 'create_component_set':
          return await this.createComponentSet(params);
        case 'get_component_sets':
          return await this.getComponentSets();
        case 'create_variant_instance':
          return await this.createVariantInstance(params);
        case 'update_variant':
          return await this.updateVariant(params);

        // ── Event Listener 工具 ──
        case 'start_event_listener':
          return await this.startEventListener(params);
        case 'stop_event_listener':
          return await this.stopEventListener(params);
        case 'get_pending_events':
          return await this.getPendingEvents(params);

        // ── Diff Engine 工具 ──
        case 'diff_snapshot':
          return await this.diffSnapshot(params);
        case 'diff_apply':
          return await this.diffApply(params);

        // ── Template 工具 ──
        case 'create_from_template':
          return await this.createFromTemplate(params);
        case 'list_templates':
          return await this.listTemplates();
        case 'save_as_template':
          return await this.saveAsTemplate(params);

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── 原有实现 ─────────────────────────────────────────────

  private async getDocumentInfo(): Promise<SemanticResult> {
    const data = await this.primitives.getDocumentInfo();
    return { success: true, data };
  }

  private async getNodeTree(params: Record<string, unknown>): Promise<SemanticResult> {
    const data = await this.primitives.getNodeTree({
      nodeId: params.nodeId as string,
      depth: params.depth as number,
    });
    return { success: true, data };
  }

  private async createContainer(params: Record<string, unknown>): Promise<SemanticResult> {
    const {
      name, semantic, direction, padding, gap,
      width, height, fill, cornerRadius, parentId,
    } = params as Record<string, unknown>;

    const fills = parseFills(fill as string | undefined);

    const node = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number | undefined,
      height: height as number | undefined,
      fills: fills as FigmaFill[],
      cornerRadius: cornerRadius as number | undefined,
    });

    if (direction || padding !== undefined || gap !== undefined) {
      const p = typeof padding === 'number' ? padding : 0;
      const g = typeof gap === 'number' ? gap : 0;
      await this.primitives.setLayout({
        nodeId: node.id,
        direction: (direction as 'HORIZONTAL' | 'VERTICAL') || 'VERTICAL',
        paddingLeft: p,
        paddingRight: p,
        paddingTop: p,
        paddingBottom: p,
        itemSpacing: g,
      });
    }

    const semanticType = (semantic as string) || 'container';
    this.registry.register({
      nodeId: node.id,
      type: semanticType,
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  private async createText(params: Record<string, unknown>): Promise<SemanticResult> {
    const { content, name, semantic, fontSize, fontWeight, fontFamily, color, parentId } = params;

    const node = await this.primitives.createTextNode({
      content: content as string,
      name: (name as string) || 'Text',
      parentId: parentId as string | undefined,
      fontSize: fontSize as number | undefined,
      fontWeight: fontWeight as string | undefined,
      fontFamily: fontFamily as string | undefined,
      color: parseColor(color as string | undefined),
    });

    const semanticType = (semantic as string) || 'text';
    this.registry.register({
      nodeId: node.id,
      type: semanticType,
      name: (name as string) || 'Text',
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  // ─── UI 组件实现 ───────────────────────────────────────────

  /** 根据按钮 variant 和 size 计算尺寸与样式 */
  private buttonStyle(variant: string, size: string) {
    const sizeMap: Record<string, { h: number; px: number; py: number; fs: number }> = {
      sm: { h: 32, px: 12, py: 6, fs: 12 },
      md: { h: 40, px: 16, py: 8, fs: 14 },
      lg: { h: 48, px: 24, py: 12, fs: 16 },
    };
    const s = sizeMap[size] || sizeMap['md'];
    const variantStyles: Record<string, { fill: string; text: string; stroke?: string }> = {
      primary: { fill: '#2563EB', text: '#FFFFFF' },
      secondary: { fill: '#F3F4F6', text: '#1F2937' },
      ghost: { fill: 'transparent', text: '#374151' },
    };
    const vs = variantStyles[variant] || variantStyles['primary'];
    return { ...s, fill: vs.fill, text: vs.text, stroke: vs.stroke };
  }

  private async createButton(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, label, variant = 'primary', size = 'md', icon, fill, textColor, parentId } = params;
    const style = this.buttonStyle(variant as string, size as string);

    const btnColor = fill && typeof fill === 'string' ? fill : style.fill;
    const txtColor = textColor && typeof textColor === 'string' ? textColor : style.text;

    // 创建按钮容器
    const btn = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      fills: parseFills(btnColor),
      cornerRadius: 6,
    });

    await this.primitives.setLayout({
      nodeId: btn.id,
      direction: 'HORIZONTAL',
      paddingLeft: style.px,
      paddingRight: style.px,
      paddingTop: style.py,
      paddingBottom: style.py,
      itemSpacing: icon ? 6 : 0,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    });

    // 添加标签文本
    const txt = await this.primitives.createTextNode({
      content: label as string,
      name: 'Label',
      parentId: btn.id,
      fontSize: style.fs,
      fontWeight: 'Medium',
      color: parseColor(txtColor),
    });

    // 如果有图标，添加图标占位
    if (icon && typeof icon === 'string') {
      await this.primitives.createTextNode({
        content: icon,
        name: 'Icon',
        parentId: btn.id,
        fontSize: style.fs,
        color: parseColor(txtColor),
      });
    }

    const entry: SemanticEntry = {
      nodeId: btn.id,
      type: 'button',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { variant, size, label, icon },
    };
    this.registry.register(entry);

    return { success: true, data: { ...btn, semantic: 'button', variant, size, children: [txt] } };
  }

  private async createCard(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, title, description, variant = 'default', layout = 'vertical', actions, width, parentId } = params;

    const isHorizontal = layout === 'horizontal';
    let cornerRadius = 8;
    let cardFills: FigmaFill[] = parseFills('#FFFFFF');
    let cardStrokes: FigmaStroke[] = [];
    let cardEffects: FigmaEffect[] = [];
    let cardStrokeWeight: number | undefined;

    if (variant === 'outlined') {
      cardStrokes = [{ type: 'SOLID', color: hexToRgb('#E5E7EB') }];
      cardStrokeWeight = 1;
    } else if (variant === 'elevated') {
      cardEffects = [{ type: 'DROP_SHADOW', offset: { x: 0, y: 2 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.1 }, visible: true, blendMode: 'NORMAL' }];
    }

    const card = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || (isHorizontal ? 400 : 320),
      fills: cardFills,
      strokes: cardStrokes,
      strokeWeight: cardStrokeWeight,
      effects: cardEffects,
      cornerRadius,
    });

    await this.primitives.setLayout({
      nodeId: card.id,
      direction: isHorizontal ? 'HORIZONTAL' : 'VERTICAL',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 16,
      paddingBottom: 16,
      itemSpacing: 12,
    });

    // 内容区
    if (title || description) {
      const contentFrame = await this.primitives.createNode({
        type: 'FRAME',
        name: 'Content',
        parentId: card.id,
      });

      await this.primitives.setLayout({
        nodeId: contentFrame.id,
        direction: 'VERTICAL',
        itemSpacing: 4,
      });

      if (title) {
        await this.primitives.createTextNode({
          content: title as string,
          name: 'Title',
          parentId: contentFrame.id,
          fontSize: 16,
          fontWeight: 'Semi Bold',
          color: parseColor('#111827'),
        });
      }

      if (description) {
        await this.primitives.createTextNode({
          content: description as string,
          name: 'Description',
          parentId: contentFrame.id,
          fontSize: 14,
          color: parseColor('#6B7280'),
        });
      }
    }

    // 操作按钮区
    if (Array.isArray(actions) && actions.length > 0) {
      const actionsFrame = await this.primitives.createNode({
        type: 'FRAME',
        name: 'Actions',
        parentId: card.id,
      });

      await this.primitives.setLayout({
        nodeId: actionsFrame.id,
        direction: 'HORIZONTAL',
        itemSpacing: 8,
      });

      for (const action of actions) {
        await this.primitives.createTextNode({
          content: action as string,
          name: `Action-${action}`,
          parentId: actionsFrame.id,
          fontSize: 14,
          fontWeight: 'Medium',
          color: parseColor('#2563EB'),
        });
      }
    }

    const entry: SemanticEntry = {
      nodeId: card.id,
      type: 'card',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { title, description, variant, layout, actions },
    };
    this.registry.register(entry);

    return { success: true, data: { ...card, semantic: 'card', variant, layout } };
  }

  private async createInput(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, placeholder, label, type = 'text', width = 320, parentId } = params;

    // 创建外层容器
    const container = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number,
    });

    await this.primitives.setLayout({
      nodeId: container.id,
      direction: 'VERTICAL',
      itemSpacing: 4,
    });

    // 标签
    if (label) {
      await this.primitives.createTextNode({
        content: label as string,
        name: 'Label',
        parentId: container.id,
        fontSize: 14,
        fontWeight: 'Medium',
        color: parseColor('#374151'),
      });
    }

    // 输入框
    const input = await this.primitives.createNode({
      type: 'FRAME',
      name: 'InputField',
      parentId: container.id,
      height: 40,
      cornerRadius: 6,
      fills: parseFills('#FFFFFF'),
      strokes: [{ type: 'SOLID', color: hexToRgb('#D1D5DB') }],
      strokeWeight: 1,
    });

    await this.primitives.setLayout({
      nodeId: input.id,
      direction: 'HORIZONTAL',
      paddingLeft: 12,
      paddingRight: 12,
      primaryAxisAlignItems: 'CENTER',
    });

    // 占位符文本
    if (placeholder) {
      await this.primitives.createTextNode({
        content: placeholder as string,
        name: 'Placeholder',
        parentId: input.id,
        fontSize: 14,
        color: parseColor('#9CA3AF'),
      });
    }

    const entry: SemanticEntry = {
      nodeId: container.id,
      type: 'input',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { placeholder, label, inputType: type },
    };
    this.registry.register(entry);

    return { success: true, data: { ...container, semantic: 'input', inputType: type } };
  }

  private async createAvatar(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, size = 40, shape = 'circle', imageUrl, fallbackText, backgroundColor, parentId } = params;

    const avatar = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: size as number,
      height: size as number,
      fills: parseFills((backgroundColor as string) || '#E5E7EB'),
      cornerRadius: shape === 'circle' ? (size as number) / 2 : 4,
    });

    await this.primitives.setLayout({
      nodeId: avatar.id,
      direction: 'VERTICAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    });

    // 显示回退文字
    if (fallbackText && typeof fallbackText === 'string') {
      await this.primitives.createTextNode({
        content: fallbackText.charAt(0).toUpperCase(),
        name: 'Fallback',
        parentId: avatar.id,
        fontSize: Math.round((size as number) * 0.4),
        fontWeight: 'Medium',
        color: parseColor('#6B7280'),
      });
    }

    const entry: SemanticEntry = {
      nodeId: avatar.id,
      type: 'avatar',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { size, shape, imageUrl, fallbackText },
    };
    this.registry.register(entry);

    return { success: true, data: { ...avatar, semantic: 'avatar', shape } };
  }

  private async createIcon(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, icon, size = 24, color, parentId } = params;

    const iconNode = await this.primitives.createTextNode({
      content: icon as string,
      name: name as string,
      parentId: parentId as string | undefined,
      fontSize: size as number,
      color: parseColor((color as string) || '#374151'),
    });

    const entry: SemanticEntry = {
      nodeId: iconNode.id,
      type: 'icon',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { icon, size },
    };
    this.registry.register(entry);

    return { success: true, data: { ...iconNode, semantic: 'icon' } };
  }

  private async createImage(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, width, height, src, cornerRadius, parentId } = params;

    const fills: unknown[] = src
      ? [{ type: 'IMAGE', url: src as string }]
      : parseFills('#E5E7EB');

    const img = await this.primitives.createNode({
      type: 'RECTANGLE',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number,
      height: height as number,
      fills: fills as FigmaFill[],
      cornerRadius: cornerRadius as number | undefined,
    });

    const entry: SemanticEntry = {
      nodeId: img.id,
      type: 'image',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { width, height, src },
    };
    this.registry.register(entry);

    return { success: true, data: { ...img, semantic: 'image' } };
  }

  private async createDivider(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, direction = 'horizontal', length, thickness = 1, color = '#E0E0E0', parentId } = params;

    const isHorizontal = direction === 'horizontal';
    const w = isHorizontal ? (length as number || 200) : (thickness as number);
    const h = isHorizontal ? (thickness as number) : (length as number || 200);

    const divider = await this.primitives.createNode({
      type: 'RECTANGLE',
      name: name as string,
      parentId: parentId as string | undefined,
      width: w,
      height: h,
      fills: parseFills(color as string),
    });

    const entry: SemanticEntry = {
      nodeId: divider.id,
      type: 'divider',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { direction, thickness, color },
    };
    this.registry.register(entry);

    return { success: true, data: { ...divider, semantic: 'divider' } };
  }

  private async createBadge(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, label, variant = 'default', parentId } = params;

    const variantColors: Record<string, { bg: string; text: string }> = {
      default: { bg: '#F3F4F6', text: '#374151' },
      success: { bg: '#D1FAE5', text: '#065F46' },
      warning: { bg: '#FEF3C7', text: '#92400E' },
      error: { bg: '#FEE2E2', text: '#991B1B' },
    };

    const vc = variantColors[variant as string] || variantColors['default'];

    const badge = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      fills: parseFills(vc.bg),
      cornerRadius: 999,
    });

    await this.primitives.setLayout({
      nodeId: badge.id,
      direction: 'HORIZONTAL',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 2,
      paddingBottom: 2,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    });

    await this.primitives.createTextNode({
      content: label as string,
      name: 'Label',
      parentId: badge.id,
      fontSize: 12,
      fontWeight: 'Medium',
      color: parseColor(vc.text),
    });

    const entry: SemanticEntry = {
      nodeId: badge.id,
      type: 'badge',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { label, variant },
    };
    this.registry.register(entry);

    return { success: true, data: { ...badge, semantic: 'badge', variant } };
  }

  // ─── 布局组件实现 ─────────────────────────────────────────

  private async createHeader(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, title, subtitle, actions, width, fill, parentId } = params;

    const header = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || 800,
      fills: parseFills((fill as string) || '#FFFFFF'),
    });

    await this.primitives.setLayout({
      nodeId: header.id,
      direction: 'HORIZONTAL',
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 16,
      paddingBottom: 16,
      primaryAxisAlignItems: 'CENTER',
    });

    // 文字区
    const textFrame = await this.primitives.createNode({
      type: 'FRAME',
      name: 'TextGroup',
      parentId: header.id,
    });

    await this.primitives.setLayout({
      nodeId: textFrame.id,
      direction: 'VERTICAL',
      itemSpacing: 2,
    });

    if (title) {
      await this.primitives.createTextNode({
        content: title as string,
        name: 'Title',
        parentId: textFrame.id,
        fontSize: 20,
        fontWeight: 'Bold',
        color: parseColor('#111827'),
      });
    }

    if (subtitle) {
      await this.primitives.createTextNode({
        content: subtitle as string,
        name: 'Subtitle',
        parentId: textFrame.id,
        fontSize: 14,
        color: parseColor('#6B7280'),
      });
    }

    // 操作按钮区
    if (Array.isArray(actions) && actions.length > 0) {
      const actionsFrame = await this.primitives.createNode({
        type: 'FRAME',
        name: 'Actions',
        parentId: header.id,
      });

      await this.primitives.setLayout({
        nodeId: actionsFrame.id,
        direction: 'HORIZONTAL',
        itemSpacing: 8,
        primaryAxisAlignItems: 'MAX',
      });

      for (const action of actions) {
        await this.primitives.createTextNode({
          content: action as string,
          name: `Action-${action}`,
          parentId: actionsFrame.id,
          fontSize: 14,
          fontWeight: 'Medium',
          color: parseColor('#2563EB'),
        });
      }
    }

    const entry: SemanticEntry = {
      nodeId: header.id,
      type: 'header',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { title, subtitle, actions },
    };
    this.registry.register(entry);

    return { success: true, data: { ...header, semantic: 'header' } };
  }

  private async createSidebar(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, items, width = 240, fill, parentId } = params;

    const sidebar = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number,
      fills: parseFills((fill as string) || '#F9FAFB'),
    });

    await this.primitives.setLayout({
      nodeId: sidebar.id,
      direction: 'VERTICAL',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 8,
      paddingBottom: 8,
      itemSpacing: 2,
    });

    if (Array.isArray(items)) {
      for (const item of items) {
        const itemFrame = await this.primitives.createNode({
          type: 'FRAME',
          name: `MenuItem-${item}`,
          parentId: sidebar.id,
          cornerRadius: 6,
        });

        await this.primitives.setLayout({
          nodeId: itemFrame.id,
          direction: 'HORIZONTAL',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
          itemSpacing: 8,
        });

        await this.primitives.createTextNode({
          content: item as string,
          name: 'Label',
          parentId: itemFrame.id,
          fontSize: 14,
          color: parseColor('#374151'),
        });
      }
    }

    const entry: SemanticEntry = {
      nodeId: sidebar.id,
      type: 'sidebar',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { items, width },
    };
    this.registry.register(entry);

    return { success: true, data: { ...sidebar, semantic: 'sidebar' } };
  }

  private async createGrid(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, columns = 3, rows = 1, gap = 16, cellWidth, cellHeight, parentId } = params;

    const cols = Math.max(1, Math.min(100, columns as number));
    const rowCount = Math.max(1, Math.min(100, rows as number));

    const grid = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
    });

    await this.primitives.setLayout({
      nodeId: grid.id,
      direction: 'HORIZONTAL',
      itemSpacing: gap as number,
      layoutWrap: 'WRAP',
    });

    // 创建单元格
    const totalCells = cols * rowCount;
    for (let i = 0; i < totalCells; i++) {
      const cell = await this.primitives.createNode({
        type: 'FRAME',
        name: `Cell-${i}`,
        parentId: grid.id,
        width: cellWidth as number | undefined,
        height: cellHeight as number | undefined,
        fills: parseFills('#F9FAFB'),
        cornerRadius: 4,
      });
    }

    const entry: SemanticEntry = {
      nodeId: grid.id,
      type: 'grid',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { columns, rows, gap, totalCells },
    };
    this.registry.register(entry);

    return { success: true, data: { ...grid, semantic: 'grid', columns, rows, totalCells } };
  }

  private async createList(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, items, direction = 'vertical', gap = 0, parentId } = params;

    const list = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
    });

    const isVertical = direction === 'vertical';
    await this.primitives.setLayout({
      nodeId: list.id,
      direction: isVertical ? 'VERTICAL' : 'HORIZONTAL',
      itemSpacing: gap as number,
    });

    if (Array.isArray(items)) {
      for (const item of items) {
        const itemFrame = await this.primitives.createNode({
          type: 'FRAME',
          name: `ListItem-${item}`,
          parentId: list.id,
        });

        await this.primitives.setLayout({
          nodeId: itemFrame.id,
          direction: 'HORIZONTAL',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
        });

        await this.primitives.createTextNode({
          content: item as string,
          name: 'Label',
          parentId: itemFrame.id,
          fontSize: 14,
          color: parseColor('#374151'),
        });
      }
    }

    const entry: SemanticEntry = {
      nodeId: list.id,
      type: 'list',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { items, direction, gap },
    };
    this.registry.register(entry);

    return { success: true, data: { ...list, semantic: 'list', direction } };
  }

  private async createForm(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, fields, width = 400, parentId } = params;

    const form = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number,
    });

    await this.primitives.setLayout({
      nodeId: form.id,
      direction: 'VERTICAL',
      itemSpacing: 16,
    });

    if (Array.isArray(fields)) {
      for (const field of fields) {
        const f = field as { type?: string; label?: string; placeholder?: string };

        // 字段容器
        const fieldFrame = await this.primitives.createNode({
          type: 'FRAME',
          name: `Field-${f.label || 'unnamed'}`,
          parentId: form.id,
        });

        await this.primitives.setLayout({
          nodeId: fieldFrame.id,
          direction: 'VERTICAL',
          itemSpacing: 4,
        });

        // 标签
        if (f.label) {
          await this.primitives.createTextNode({
            content: f.label,
            name: 'Label',
            parentId: fieldFrame.id,
            fontSize: 14,
            fontWeight: 'Medium',
            color: parseColor('#374151'),
          });
        }

        // 输入框
        const inputField = await this.primitives.createNode({
          type: 'FRAME',
          name: 'Input',
          parentId: fieldFrame.id,
          height: 40,
          cornerRadius: 6,
          fills: parseFills('#FFFFFF'),
          strokes: [{ type: 'SOLID', color: hexToRgb('#D1D5DB') }],
          strokeWeight: 1,
        });

        await this.primitives.setLayout({
          nodeId: inputField.id,
          direction: 'HORIZONTAL',
          paddingLeft: 12,
          paddingRight: 12,
          primaryAxisAlignItems: 'CENTER',
        });

        if (f.placeholder) {
          await this.primitives.createTextNode({
            content: f.placeholder,
            name: 'Placeholder',
            parentId: inputField.id,
            fontSize: 14,
            color: parseColor('#9CA3AF'),
          });
        }
      }
    }

    const entry: SemanticEntry = {
      nodeId: form.id,
      type: 'form',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { fields },
    };
    this.registry.register(entry);

    return { success: true, data: { ...form, semantic: 'form' } };
  }

  private async createModal(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, title, content, width = 480, parentId } = params;

    // 外层遮罩容器
    const modal = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number,
      cornerRadius: 12,
      fills: parseFills('#FFFFFF'),
      effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, radius: 24, color: { r: 0, g: 0, b: 0, a: 0.15 }, visible: true, blendMode: 'NORMAL' }] as FigmaEffect[],
    });

    await this.primitives.setLayout({
      nodeId: modal.id,
      direction: 'VERTICAL',
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 24,
      paddingBottom: 24,
      itemSpacing: 16,
    });

    // 标题栏
    const header = await this.primitives.createNode({
      type: 'FRAME',
      name: 'ModalHeader',
      parentId: modal.id,
    });

    await this.primitives.setLayout({
      nodeId: header.id,
      direction: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
    });

    await this.primitives.createTextNode({
      content: title as string,
      name: 'Title',
      parentId: header.id,
      fontSize: 18,
      fontWeight: 'Bold',
      color: parseColor('#111827'),
    });

    // 关闭按钮
    await this.primitives.createTextNode({
      content: '×',
      name: 'CloseButton',
      parentId: header.id,
      fontSize: 20,
      color: parseColor('#9CA3AF'),
    });

    // 内容
    if (content) {
      await this.primitives.createTextNode({
        content: content as string,
        name: 'Content',
        parentId: modal.id,
        fontSize: 14,
        color: parseColor('#4B5563'),
      });
    }

    // 底部操作区
    const footer = await this.primitives.createNode({
      type: 'FRAME',
      name: 'ModalFooter',
      parentId: modal.id,
    });

    await this.primitives.setLayout({
      nodeId: footer.id,
      direction: 'HORIZONTAL',
      itemSpacing: 8,
      primaryAxisAlignItems: 'MAX',
    });

    await this.primitives.createTextNode({
      content: 'Cancel',
      name: 'CancelBtn',
      parentId: footer.id,
      fontSize: 14,
      fontWeight: 'Medium',
      color: parseColor('#6B7280'),
    });

    await this.primitives.createTextNode({
      content: 'Confirm',
      name: 'ConfirmBtn',
      parentId: footer.id,
      fontSize: 14,
      fontWeight: 'Medium',
      color: parseColor('#FFFFFF'),
    });

    const entry: SemanticEntry = {
      nodeId: modal.id,
      type: 'modal',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { title, content },
    };
    this.registry.register(entry);

    return { success: true, data: { ...modal, semantic: 'modal' } };
  }

  private async createNavigation(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, items, width, fill, parentId } = params;

    const nav = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number | undefined,
      fills: parseFills((fill as string) || '#FFFFFF'),
    });

    await this.primitives.setLayout({
      nodeId: nav.id,
      direction: 'HORIZONTAL',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 8,
      paddingBottom: 8,
      itemSpacing: 24,
      primaryAxisAlignItems: 'CENTER',
    });

    if (Array.isArray(items)) {
      for (const item of items) {
        const navItem = item as { label?: string; icon?: string };

        const itemFrame = await this.primitives.createNode({
          type: 'FRAME',
          name: `NavItem-${navItem.label || 'unnamed'}`,
          parentId: nav.id,
        });

        await this.primitives.setLayout({
          nodeId: itemFrame.id,
          direction: 'HORIZONTAL',
          itemSpacing: 6,
          primaryAxisAlignItems: 'CENTER',
        });

        if (navItem.icon) {
          await this.primitives.createTextNode({
            content: navItem.icon,
            name: 'Icon',
            parentId: itemFrame.id,
            fontSize: 16,
            color: parseColor('#374151'),
          });
        }

        if (navItem.label) {
          await this.primitives.createTextNode({
            content: navItem.label,
            name: 'Label',
            parentId: itemFrame.id,
            fontSize: 14,
            color: parseColor('#374151'),
          });
        }
      }
    }

    const entry: SemanticEntry = {
      nodeId: nav.id,
      type: 'navigation',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { items },
    };
    this.registry.register(entry);

    return { success: true, data: { ...nav, semantic: 'navigation' } };
  }

  private async createHero(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, title, subtitle, cta, width, height, fill, parentId } = params;

    const hero = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || 800,
      height: (height as number) || 400,
      fills: parseFills((fill as string) || '#F9FAFB'),
    });

    await this.primitives.setLayout({
      nodeId: hero.id,
      direction: 'VERTICAL',
      paddingLeft: 48,
      paddingRight: 48,
      paddingTop: 48,
      paddingBottom: 48,
      itemSpacing: 16,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
    });

    if (title) {
      await this.primitives.createTextNode({
        content: title as string,
        name: 'Title',
        parentId: hero.id,
        fontSize: 36,
        fontWeight: 'Bold',
        color: parseColor('#111827'),
      });
    }

    if (subtitle) {
      await this.primitives.createTextNode({
        content: subtitle as string,
        name: 'Subtitle',
        parentId: hero.id,
        fontSize: 18,
        color: parseColor('#6B7280'),
      });
    }

    if (cta) {
      const ctaBtn = await this.primitives.createNode({
        type: 'FRAME',
        name: 'CTA',
        parentId: hero.id,
        fills: parseFills('#2563EB'),
        cornerRadius: 8,
      });

      await this.primitives.setLayout({
        nodeId: ctaBtn.id,
        direction: 'HORIZONTAL',
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 12,
        paddingBottom: 12,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
      });

      await this.primitives.createTextNode({
        content: cta as string,
        name: 'CTALabel',
        parentId: ctaBtn.id,
        fontSize: 16,
        fontWeight: 'Semi Bold',
        color: parseColor('#FFFFFF'),
      });
    }

    const entry: SemanticEntry = {
      nodeId: hero.id,
      type: 'hero',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { title, subtitle, cta },
    };
    this.registry.register(entry);

    return { success: true, data: { ...hero, semantic: 'hero' } };
  }

  private async createToast(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, message, variant = 'info', width, parentId } = params;

    const colorMap: Record<string, string> = {
      success: '#059669',
      error: '#DC2626',
      info: '#2563EB',
      warning: '#D97706',
    };
    const bgColorMap: Record<string, string> = {
      success: '#ECFDF5',
      error: '#FEF2F2',
      info: '#EFF6FF',
      warning: '#FFFBEB',
    };

    const toast = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || 360,
      fills: parseFills(bgColorMap[variant as string] || bgColorMap.info),
      cornerRadius: 8,
    });

    await this.primitives.setLayout({
      nodeId: toast.id,
      direction: 'HORIZONTAL',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
      itemSpacing: 8,
      counterAxisAlignItems: 'CENTER',
    });

    // 指示条
    await this.primitives.createNode({
      type: 'RECTANGLE',
      name: 'Indicator',
      parentId: toast.id,
      width: 4,
      height: 20,
      fills: parseFills(colorMap[variant as string] || colorMap.info),
      cornerRadius: 2,
    } as any);

    await this.primitives.createTextNode({
      content: message as string,
      name: 'Message',
      parentId: toast.id,
      fontSize: 14,
      color: parseColor('#1F2937'),
    });

    const entry: SemanticEntry = {
      nodeId: toast.id,
      type: 'toast',
      name: name as string,
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
      metadata: { message, variant },
    };
    this.registry.register(entry);

    return { success: true, data: { ...toast, semantic: 'toast', variant } };
  }

  // ─── 读取工具实现 ─────────────────────────────────────────

  private async findNodes(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, type: nodeType, semantic, recursive, maxDepth, propertyFilter } = params;

    // 如果指定了语义标签，从注册表查找
    if (semantic && typeof semantic === 'string') {
      const entries = this.registry.findByType(semantic);
      if (name && typeof name === 'string') {
        // 进一步过滤名称（转义正则特殊字符后再替换通配符）
        const escaped = (name as string).replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
          '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i'
        );
        const filtered = entries.filter(e => regex.test(e.name));
        return { success: true, data: { nodes: filtered, count: filtered.length } };
      }
      return { success: true, data: { nodes: entries, count: entries.length } };
    }

    // 否则使用 primitive findNodes
    const data = await this.primitives.findNodes({
      name: name as string | undefined,
      type: nodeType as string | undefined,
      recursive: recursive as boolean | undefined,
      maxDepth: maxDepth as number | undefined,
      propertyFilter: propertyFilter as Record<string, unknown> | undefined,
    });
    return { success: true, data };
  }

  private async getNodeProperties(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, properties } = params;

    const data = await this.primitives.getNodeProperties({
      nodeId: nodeId as string,
      properties: properties as string[] | undefined,
    });
    return { success: true, data };
  }

  private async getStyles(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId } = params;

    const data = await this.primitives.getStyles({
      nodeId: nodeId as string | undefined,
    });
    return { success: true, data };
  }

  private async getSemanticMap(params: Record<string, unknown>): Promise<SemanticResult> {
    const { filter } = params;

    const entries = this.registry.findAll(filter as Parameters<typeof this.registry.findAll>[0]);
    return {
      success: true,
      data: {
        entries,
        count: entries.length,
        totalRegistered: this.registry.size,
      },
    };
  }

  // ─── 修改工具实现 ─────────────────────────────────────────

  private async updateNode(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, properties } = params;

    // 颜色属性需要转换
    const processedProps: Record<string, unknown> = {};
    if (properties && typeof properties === 'object') {
      for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
        if ((key === 'fills' || key === 'color') && typeof value === 'string') {
          processedProps[key] = parseFills(value);
        } else {
          processedProps[key] = value;
        }
      }
    }

    const data = await this.primitives.setProperties({
      nodeId: nodeId as string,
      properties: processedProps,
    });
    return { success: true, data };
  }

  private async updateBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    const { semantic, properties, filter } = params;

    const entries = this.registry.findAll(
      filter ? { ...(filter as Record<string, string>), type: semantic as string } : { type: semantic as string }
    );

    const results: unknown[] = [];
    for (const entry of entries) {
      const data = await this.primitives.setProperties({
        nodeId: entry.nodeId,
        properties: properties as Record<string, unknown>,
      });
      results.push(data);
    }

    return {
      success: true,
      data: { updated: results.length, results },
    };
  }

  private async deleteNode(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId } = params;

    await this.primitives.deleteNode({ nodeId: nodeId as string });
    this.registry.unregister(nodeId as string);

    return { success: true, data: { deleted: nodeId } };
  }

  private async deleteBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    const { semantic, filter } = params;

    const entries = this.registry.findAll(
      filter ? { ...(filter as Record<string, string>), type: semantic as string } : { type: semantic as string }
    );

    const deleted: string[] = [];
    for (const entry of entries) {
      await this.primitives.deleteNode({ nodeId: entry.nodeId });
      this.registry.unregister(entry.nodeId);
      deleted.push(entry.nodeId);
    }

    return {
      success: true,
      data: { deleted, count: deleted.length },
    };
  }

  private async moveNode(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, parentId, index } = params;

    await this.primitives.moveNode({
      nodeId: nodeId as string,
      newParentId: parentId as string,
      index: index as number | undefined,
    });

    // 更新注册表中的 parentId
    const entry = this.registry.get(nodeId as string);
    if (entry) {
      this.registry.register({ ...entry, parentId: parentId as string });
    }

    return { success: true, data: { moved: nodeId, to: parentId } };
  }

  private async reorderBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    const { semantic, order = 'asc' } = params;

    const entries = this.registry.findByType(semantic as string);
    if (entries.length === 0) {
      return { success: true, data: { reordered: 0, message: 'No entries found for this semantic type' } };
    }

    // 按创建时间或名称排序
    const sorted = [...entries].sort((a, b) => {
      switch (order) {
        case 'asc': return a.createdAt - b.createdAt;
        case 'desc': return b.createdAt - a.createdAt;
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        default: return a.createdAt - b.createdAt;
      }
    });

    // 找到共同的父节点，然后重排
    const parentIds = new Set(sorted.map(e => e.parentId).filter(Boolean));
    if (parentIds.size === 1) {
      const parentId = sorted[0].parentId!;
      for (let i = 0; i < sorted.length; i++) {
        await this.primitives.moveNode({
          nodeId: sorted[i].nodeId,
          newParentId: parentId,
          index: i,
        });
      }
    }

    return {
      success: true,
      data: { reordered: sorted.length, order },
    };
  }

  // ─── 导出工具实现 ─────────────────────────────────────────

  private async exportNode(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, format = 'PNG', scale = 1 } = params;

    const data = await this.primitives.exportNode({
      nodeId: nodeId as string,
      format: format as 'PNG' | 'JPG' | 'SVG' | 'PDF',
      scale: scale as number,
    });
    return { success: true, data };
  }

  private async exportBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    const { semantic, format = 'PNG', scale = 1, filter } = params;

    const entries = this.registry.findAll(
      filter ? { ...(filter as Record<string, string>), type: semantic as string } : { type: semantic as string }
    );

    const results: unknown[] = [];
    for (const entry of entries) {
      const data = await this.primitives.exportNode({
        nodeId: entry.nodeId,
        format: format as 'PNG' | 'JPG' | 'SVG' | 'PDF',
        scale: scale as number,
      });
      results.push({ nodeId: entry.nodeId, name: entry.name, data });
    }

    return {
      success: true,
      data: { exported: results.length, results },
    };
  }

  // ─── 系统工具实现 ─────────────────────────────────────────

  private async batchExecute(params: Record<string, unknown>): Promise<SemanticResult> {
    const { commands, rollback } = params as {
      commands: Array<{ tool: string; params: Record<string, unknown> }>;
      rollback?: boolean;
    };

    if (!Array.isArray(commands)) {
      return { success: false, error: 'commands must be an array' };
    }

    const results: Array<{ tool: string; result: SemanticResult }> = [];
    const createdNodeIds: string[] = [];

    for (const cmd of commands) {
      const c = cmd as { tool: string; params: Record<string, unknown> };
      const result = await this.execute(c.tool, c.params || {});
      results.push({ tool: c.tool, result });

      // 追踪创建的节点 ID（从 result.data 中提取）
      if (result.success && result.data && typeof result.data === 'object') {
        const data = result.data as Record<string, unknown>;
        if (data.id && typeof data.id === 'string') {
          createdNodeIds.push(data.id);
        }
      }

      // 如果某个命令失败
      if (!result.success) {
        if (rollback && createdNodeIds.length > 0) {
          // 回滚：逆序删除已创建的节点
          const rollbackErrors: string[] = [];
          for (let i = createdNodeIds.length - 1; i >= 0; i--) {
            try {
              await this.primitives.deleteNode({ nodeId: createdNodeIds[i] });
            } catch (rErr) {
              rollbackErrors.push(`${createdNodeIds[i]}: ${rErr instanceof Error ? rErr.message : String(rErr)}`);
            }
          }
          return {
            success: false,
            error: `Batch failed at step ${results.length - 1} (${c.tool}): ${result.error}. Rolled back ${createdNodeIds.length} nodes.`,
            data: { results, executed: results.length, total: commands.length, rolledBack: true, rolledBackCount: createdNodeIds.length, rollbackErrors },
          };
        }
        break;
      }
    }

    const allSuccess = results.every(r => r.result.success);
    return {
      success: allSuccess,
      data: { results, executed: results.length, total: commands.length, rolledBack: false },
    };
  }

  // ─── Variables 工具实现 ─────────────────────────────────────

  private async createVariableCollection(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, modes } = params as { name: string; modes: string[] };
    const data = await this.primitives.createVariableCollection({ name, modes });
    return { success: true, data };
  }

  private async getVariableCollections(): Promise<SemanticResult> {
    const data = await this.primitives.getVariableCollections();
    return { success: true, data };
  }

  private async createVariable(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, collectionId, resolvedType, valuesByMode } = params as {
      name: string;
      collectionId: string;
      resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
      valuesByMode: Record<string, unknown>;
    };
    const data = await this.primitives.createVariable({ name, collectionId, resolvedType, valuesByMode });
    return { success: true, data };
  }

  private async getVariables(params: Record<string, unknown>): Promise<SemanticResult> {
    const { type, collectionId } = params as {
      type?: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
      collectionId?: string;
    };
    const data = await this.primitives.getVariables({ type, collectionId });
    return { success: true, data };
  }

  private async updateVariable(params: Record<string, unknown>): Promise<SemanticResult> {
    const { variableId, modeId, value } = params as {
      variableId: string;
      modeId: string;
      value: unknown;
    };
    const data = await this.primitives.updateVariableValue({ variableId, modeId, value });
    return { success: true, data };
  }

  private async deleteVariable(params: Record<string, unknown>): Promise<SemanticResult> {
    const { variableId } = params as { variableId: string };
    await this.primitives.deleteVariable({ variableId });
    return { success: true, data: { deleted: true, variableId } };
  }

  // ─── Component Variants 工具实现 ───────────────────────────

  private async createComponentSet(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, variants, parentId } = params as {
      name: string;
      variants: Array<{ name: string; properties: Record<string, string>; width?: number; height?: number }>;
      parentId?: string;
    };
    const data = await this.primitives.createComponentSet({ name, variants, parentId });
    return { success: true, data };
  }

  private async getComponentSets(): Promise<SemanticResult> {
    const data = await this.primitives.getComponentSets();
    return { success: true, data };
  }

  private async createVariantInstance(params: Record<string, unknown>): Promise<SemanticResult> {
    const { componentSetId, variantProperties, parentId } = params as {
      componentSetId: string;
      variantProperties: Record<string, string>;
      parentId?: string;
    };
    const data = await this.primitives.createVariantInstance({ componentSetId, variantProperties, parentId });
    return { success: true, data };
  }

  private async updateVariant(params: Record<string, unknown>): Promise<SemanticResult> {
    const { componentId, properties } = params as {
      componentId: string;
      properties: Record<string, string>;
    };
    const data = await this.primitives.setVariantProperties({ componentId, properties });
    return { success: true, data };
  }

  // ─── Event Listener 工具实现 ─────────────────────────────

  private async startEventListener(params: Record<string, unknown>): Promise<SemanticResult> {
    const { events } = params as { events: string[] };
    const data = await this.primitives.startListening({ events: events as StartListeningParams['events'] });
    return { success: true, data };
  }

  private async stopEventListener(params: Record<string, unknown>): Promise<SemanticResult> {
    const { events } = params as { events?: string[] };
    const data = await this.primitives.stopListening({ events });
    return { success: true, data };
  }

  private async getPendingEvents(params: Record<string, unknown>): Promise<SemanticResult> {
    const { since } = params as { since?: number };
    const events = since
      ? this.eventQueue.filter(e => e.timestamp > since)
      : [...this.eventQueue];
    return { success: true, data: { events, count: events.length } };
  }

  // ─── Diff Engine 工具实现 ─────────────────────────────────

  private async diffSnapshot(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, depth } = params as { nodeId?: string; depth?: number };
    const snapshot = await this.primitives.snapshotNode({ nodeId, depth });
    return { success: true, data: snapshot };
  }

  private async diffApply(params: Record<string, unknown>): Promise<SemanticResult> {
    const { targetSnapshot, parentId } = params as {
      targetSnapshot: NodeSnapshot;
      parentId?: string;
    };

    if (!targetSnapshot) {
      return { success: false, error: 'targetSnapshot is required' };
    }

    // 获取当前状态快照
    const currentSnapshot = await this.primitives.snapshotNode({
      nodeId: parentId,
      depth: 10,
    }) as NodeSnapshot;

    // 计算 diff
    const diffs = this.computeDiff(currentSnapshot, targetSnapshot);

    // 应用变更
    const applied: string[] = [];
    const errors: Array<{ diff: string; error: string }> = [];
    for (const diff of diffs) {
      try {
        if (diff.type === 'modify' && diff.properties) {
          await this.primitives.setProperties({
            nodeId: diff.id,
            properties: diff.properties,
          });
          applied.push(`modify:${diff.id}`);
        } else if (diff.type === 'add' && diff.properties) {
          await this.primitives.createNode({
            type: (diff.properties.type as NodeSnapshot['type'] || 'FRAME') as 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'INSTANCE',
            name: diff.name || 'node',
            parentId: diff.parentId || parentId,
            ...diff.properties,
          } as any);
          applied.push(`add:${diff.name}`);
        } else if (diff.type === 'remove') {
          await this.primitives.deleteNode({ nodeId: diff.id });
          applied.push(`remove:${diff.id}`);
        }
      } catch (err) {
        errors.push({
          diff: `${diff.type}:${diff.id}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      success: errors.length === 0,
      data: { diffs: diffs.length, applied: applied.length, changes: applied, errors },
    };
  }

  /** 计算两个快照之间的差异 */
  private computeDiff(current: NodeSnapshot, target: NodeSnapshot): NodeDiff[] {
    const diffs: NodeDiff[] = [];
    this.diffNode(current, target, diffs);
    return diffs;
  }

  private diffNode(current: NodeSnapshot, target: NodeSnapshot, diffs: NodeDiff[]): void {
    // 对比属性
    const changedProps: Record<string, unknown> = {};
    let hasChanges = false;

    for (const [key, value] of Object.entries(target.properties)) {
      const currentVal = current.properties[key];
      if (JSON.stringify(currentVal) !== JSON.stringify(value)) {
        changedProps[key] = value;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      diffs.push({
        id: current.id,
        type: 'modify',
        name: target.name,
        properties: changedProps,
      });
    }

    // 对比子节点
    const currentChildren = current.children || [];
    const targetChildren = target.children || [];

    // 找出需要新增的子节点
    const currentIds = new Set(currentChildren.map(c => c.id));
    const targetIds = new Set(targetChildren.map(c => c.id));

    for (const tc of targetChildren) {
      if (!currentIds.has(tc.id)) {
        diffs.push({
          id: tc.id,
          type: 'add',
          name: tc.name,
          properties: tc.properties,
          parentId: current.id,
        });
      }
    }

    // 找出需要删除的子节点
    for (const cc of currentChildren) {
      if (!targetIds.has(cc.id)) {
        diffs.push({
          id: cc.id,
          type: 'remove',
          name: cc.name,
        });
      }
    }

    // 递归对比共有子节点
    for (const tc of targetChildren) {
      const cc = currentChildren.find(c => c.id === tc.id);
      if (cc) {
        this.diffNode(cc, tc, diffs);
      }
    }
  }

  // ─── Template 工具实现 ───────────────────────────────────

  private async createFromTemplate(params: Record<string, unknown>): Promise<SemanticResult> {
    const { templateName, parameters, parentId } = params as {
      templateName: string;
      parameters?: Record<string, unknown>;
      parentId?: string;
    };

    const template = this.templateRegistry.get(templateName);
    if (!template) {
      return { success: false, error: `Template not found: ${templateName}` };
    }

    const commands = this.templateRegistry.instantiate(template, parameters || {}, parentId);
    const results: Array<{ tool: string; result: SemanticResult }> = [];

    for (const cmd of commands) {
      const result = await this.execute(cmd.tool, cmd.params);
      results.push({ tool: cmd.tool, result });
      if (!result.success) break;
    }

    const allSuccess = results.every(r => r.result.success);
    return {
      success: allSuccess,
      data: { template: templateName, results, executed: results.length },
    };
  }

  private async listTemplates(): Promise<SemanticResult> {
    const templates = this.templateRegistry.list();
    return { success: true, data: { templates, count: templates.length } };
  }

  private async saveAsTemplate(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, description, tools, parameters } = params as {
      name: string;
      description: string;
      tools: Array<{ tool: string; params: Record<string, unknown> }>;
      parameters?: Record<string, { type: string; description: string; default?: unknown }>;
    };

    this.templateRegistry.register({ name, description, tools, parameters });
    return { success: true, data: { name, description, toolCount: tools.length } };
  }
}
