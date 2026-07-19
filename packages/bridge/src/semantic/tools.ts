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
import type { PluginEvent, StartListeningParams, NodeSnapshot, NodeDiff, SetLayoutParams } from '@figma-forge/shared';
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
    description: '创建一个容器（Frame），支持 Auto Layout。这是放置其他元素的唯一正确方式。所有子元素都应该通过 parentId 放入容器中，容器会自动处理布局避免重叠\n⚠️ 如果已知子元素数量和尺寸，先调用 calculate_layout 计算容器所需尺寸。\n不指定 width/height 时容器会 HUG 自适应。需要固定尺寸时请精确计算。\nclipsContent=true 时超出容器的内容会被裁切。',
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
        horizontalSizing: {
          type: 'string',
          enum: ['FIXED', 'HUG', 'FILL'],
          description: '横向尺寸策略。默认：传入 width 时为 FIXED，否则为 HUG；FILL 仅适用于 Auto Layout 父容器中的子节点',
        },
        verticalSizing: {
          type: 'string',
          enum: ['FIXED', 'HUG', 'FILL'],
          description: '纵向尺寸策略。默认：传入 height 时为 FIXED，否则为 HUG；FILL 仅适用于 Auto Layout 父容器中的子节点',
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
        x: {
          type: 'number',
          description: '创建时的 X 坐标（父容器内的绝对位置）。仅在父容器非 Auto Layout 时有效',
        },
        y: {
          type: 'number',
          description: '创建时的 Y 坐标（父容器内的绝对位置）。仅在父容器非 Auto Layout 时有效',
        },
        layoutPreset: {
          type: 'string',
          description: '布局预设，自动应用一组预定义的布局属性。可选值: centered, stretch-fill, hug-content, sidebar-left, stack-vertical, grid-cell',
          enum: ['centered', 'stretch-fill', 'hug-content', 'sidebar-left', 'stack-vertical', 'grid-cell'],
        },
        layoutWrap: {
          type: 'string',
          enum: ['NO_WRAP', 'WRAP'],
          description: 'WRAP 模式下子元素自动换行（需配合 width 固定宽度使用）',
        },
        counterAxisSpacing: {
          type: 'number',
          description: '交叉轴间距（WRAP 模式的行间距，px）',
        },
        clipsContent: {
          type: 'boolean',
          description: '是否裁切超出容器的内容，默认 false',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_text',
    description: '创建文本节点。必须指定 parentId 将其放入容器中，否则会在页面根级别重叠\n⚠️ 始终提供 parentId 以确保精确定位。不提供时文本会添加到页面根部。',
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
        x: { type: 'number', description: '创建时的 X 坐标（父容器内的绝对位置）' },
        y: { type: 'number', description: '创建时的 Y 坐标（父容器内的绝对位置）' },
      },
      required: ['content'],
    },
  },

  // ── UI 组件工具 ──
  {
    name: 'create_button',
    description: '创建按钮组件，支持 primary/secondary/ghost 样式和 sm/md/lg 尺寸。必须通过 parentId 放入容器中\n⚠️ 始终提供 parentId。不提供时按钮会添加到页面根部并自动偏移。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '按钮名称' },
        label: { type: 'string', description: '按钮文字' },
        variant: { type: 'string', enum: ['primary', 'secondary', 'ghost'], description: '按钮样式', default: 'primary' },
        size: { type: 'string', enum: ['sm', 'md', 'lg'], description: '按钮尺寸', default: 'md' },
        icon: { type: 'string', description: '图标名称（可选）' },
        borderRadius: { type: 'number', description: '自定义圆角半径（px），默认 6' },
        fill: { type: 'string', description: '背景颜色（hex，仅 primary 可用）' },
        textColor: { type: 'string', description: '文字颜色（hex）' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标（父容器内的绝对位置）' },
        y: { type: 'number', description: '创建时的 Y 坐标（父容器内的绝对位置）' },
      },
      required: ['name', 'label'],
    },
  },
  {
    name: 'create_card',
    description: '创建卡片组件，支持 default/outlined/elevated 样式和 vertical/horizontal 布局。通过 parentId 放入容器中\n⚠️ 如果已知子元素尺寸，先调用 calculate_layout 计算所需卡片尺寸。\n始终提供 parentId 以确保精确定位。',
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
        borderRadius: { type: 'number', description: '自定义圆角半径（px），默认 8' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标（父容器内的绝对位置）' },
        y: { type: 'number', description: '创建时的 Y 坐标（父容器内的绝对位置）' },
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
    description: '创建矢量图标节点。支持两种模式：1) 通过 svg 参数直接提供 SVG 图标内容；2) 通过 iconName 选择内置图标（arrow, check, close, search, heart, star, plus, minus, chevron-right, chevron-left, chevron-down, chevron-up, eye, lock, settings, home, user, mail, phone, calendar, clock, trash, edit, copy, download, upload, share, filter, sort, refresh）。如果不匹配内置图标则创建文本占位',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '图标名称' },
        icon: { type: 'string', description: '图标字符（作为文本占位，当 svg 和 iconName 都未提供时使用）' },
        iconName: {
          type: 'string',
          description: '内置图标名称（优先于 icon 文本占位）',
          enum: ['arrow', 'check', 'close', 'search', 'heart', 'star', 'plus', 'minus', 'chevron-right', 'chevron-left', 'chevron-down', 'chevron-up', 'eye', 'lock', 'settings', 'home', 'user', 'mail', 'phone', 'calendar', 'clock', 'trash', 'edit', 'copy', 'download', 'upload', 'share', 'filter', 'sort', 'refresh'],
        },
        svg: { type: 'string', description: '自定义 SVG 图标内容（最高优先级）' },
        size: { type: 'number', description: '尺寸（px）', default: 24 },
        color: { type: 'string', description: '图标颜色（hex）', default: '#374151' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_image',
    description: '创建图片节点。提供 src 时下载图片并创建真实 IMAGE 填充，否则创建纯色占位',
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

  // ── 曲线与矢量工具 ──
  {
    name: 'import_svg',
    description: '导入任意 SVG 内容并创建 Figma 矢量节点。支持所有 SVG 元素：路径、贝塞尔曲线、圆弧、复杂形状等。这是创建自定义曲线和矢量图形的首选工具',
    inputSchema: {
      type: 'object',
      properties: {
        svg: { type: 'string', description: '完整的 SVG 字符串（包含 <svg> 标签）。支持 path、circle、rect、ellipse、line、polyline、polygon 等所有 SVG 元素' },
        name: { type: 'string', description: '导入后的节点名称' },
        semantic: { type: 'string', description: '语义标签（如 "logo", "decoration", "custom-curve"）' },
        parentId: { type: 'string', description: '父节点 ID（不传则创建在当前页面）' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
      required: ['svg'],
    },
  },
  {
    name: 'create_path',
    description: '通过结构化的控制点数据创建贝塞尔曲线路径。每个点可以有进入和退出控制柄（handleIn/handleOut），用于精确控制曲线形状',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description: '路径点数组。第一个点定义起点，后续点通过控制柄定义曲线段',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X 坐标' },
              y: { type: 'number', description: 'Y 坐标' },
              handleIn: { type: 'object', description: '进入控制柄（相对于点的偏移量）', properties: { x: { type: 'number' }, y: { type: 'number' } } },
              handleOut: { type: 'object', description: '退出控制柄（相对于点的偏移量）', properties: { x: { type: 'number' }, y: { type: 'number' } } },
            },
            required: ['x', 'y'],
          },
        },
        closed: { type: 'boolean', description: '是否闭合路径（首尾相连）', default: false },
        strokeColor: { type: 'string', description: '描边颜色（hex 格式）' },
        strokeWidth: { type: 'number', description: '描边宽度（px）', default: 1 },
        fillColor: { type: 'string', description: '填充颜色（hex 格式）' },
        name: { type: 'string', description: '路径节点名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
      required: ['points'],
    },
  },
  {
    name: 'create_arc',
    description: '创建圆弧路径。支持指定起始角度、结束角度、半径和中心点。可用于创建弧形装饰、进度环等',
    inputSchema: {
      type: 'object',
      properties: {
        cx: { type: 'number', description: '圆心 X 坐标', default: 0 },
        cy: { type: 'number', description: '圆心 Y 坐标', default: 0 },
        radius: { type: 'number', description: '弧形半径（px）', default: 50 },
        startAngle: { type: 'number', description: '起始角度（度，0=右，顺时针）', default: 0 },
        endAngle: { type: 'number', description: '结束角度（度）', default: 180 },
        strokeColor: { type: 'string', description: '描边颜色（hex）', default: '#000000' },
        strokeWidth: { type: 'number', description: '描边宽度（px）', default: 2 },
        fillColor: { type: 'string', description: '填充颜色（hex，不填则无填充）' },
        name: { type: 'string', description: '节点名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
    },
  },
  {
    name: 'create_wave',
    description: '创建波浪形路径。可用于装饰性的波浪分隔线、水波纹效果等',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: '波浪总宽度（px）', default: 200 },
        amplitude: { type: 'number', description: '波幅（振幅，px）', default: 20 },
        frequency: { type: 'number', description: '波浪周期数', default: 2 },
        strokeWidth: { type: 'number', description: '描边宽度（px）', default: 2 },
        strokeColor: { type: 'string', description: '描边颜色（hex）', default: '#000000' },
        fillColor: { type: 'string', description: '填充颜色（hex）' },
        filled: { type: 'boolean', description: '是否创建闭合填充波浪（填充到基线）', default: false },
        name: { type: 'string', description: '节点名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
    },
  },
  {
    name: 'create_bezier_curve',
    description: '在两个点之间创建三次贝塞尔曲线。指定起点、终点和两个控制点来定义曲线形状。适用于创建平滑的连接线、曲线箭头等',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number', description: '起点 X 坐标' },
        y1: { type: 'number', description: '起点 Y 坐标' },
        x2: { type: 'number', description: '终点 X 坐标' },
        y2: { type: 'number', description: '终点 Y 坐标' },
        cp1x: { type: 'number', description: '第一个控制点 X（影响起点出方向）' },
        cp1y: { type: 'number', description: '第一个控制点 Y' },
        cp2x: { type: 'number', description: '第二个控制点 X（影响终点入方向）' },
        cp2y: { type: 'number', description: '第二个控制点 Y' },
        strokeColor: { type: 'string', description: '描边颜色（hex）', default: '#000000' },
        strokeWidth: { type: 'number', description: '描边宽度（px）', default: 2 },
        name: { type: 'string', description: '节点名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'create_custom_shape',
    description: '通过点数组创建自定义闭合形状。支持直线段和曲线段混合使用。适用于创建有机形状、blob、盾牌、徽章等非标准形状',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description: '形状轮廓点数组',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X 坐标' },
              y: { type: 'number', description: 'Y 坐标' },
              handleIn: { type: 'object', description: '进入控制柄偏移', properties: { x: { type: 'number' }, y: { type: 'number' } } },
              handleOut: { type: 'object', description: '退出控制柄偏移', properties: { x: { type: 'number' }, y: { type: 'number' } } },
            },
            required: ['x', 'y'],
          },
        },
        fillColor: { type: 'string', description: '填充颜色（hex）', default: '#E5E7EB' },
        strokeColor: { type: 'string', description: '描边颜色（hex）' },
        strokeWidth: { type: 'number', description: '描边宽度（px）', default: 0 },
        name: { type: 'string', description: '形状名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
      required: ['points'],
    },
  },

  // ── 位图矢量化工具 ──
  {
    name: 'trace_image',
    description: '将位图（PNG）图像自动追踪转换为矢量 SVG 路径并导入 Figma。支持 base64 编码的 PNG 数据或本地文件路径。使用 imagetracerjs 算法进行颜色量化和路径追踪，生成可编辑的矢量节点',
    inputSchema: {
      type: 'object',
      properties: {
        imageData: { type: 'string', description: 'base64 编码的 PNG 图像数据（不含 data:image 前缀）' },
        filePath: { type: 'string', description: '本地 PNG 文件路径（与 imageData 二选一）' },
        colors: { type: 'number', description: '颜色数量（2-64），越少越简化', default: 8 },
        pathPrecision: { type: 'number', description: '路径精度（1=粗糙, 5=精细）', default: 3 },
        simplify: { type: 'boolean', description: '是否简化路径', default: true },
        scale: { type: 'number', description: '输出缩放比例', default: 1 },
        name: { type: 'string', description: '节点名称' },
        semantic: { type: 'string', description: '语义标签' },
        parentId: { type: 'string', description: '父节点 ID' },
        x: { type: 'number', description: '创建时的 X 坐标' },
        y: { type: 'number', description: '创建时的 Y 坐标' },
      },
    },
  },

  // ── 布局组件工具 ──
  {
    name: 'create_header',
    description: '创建页头组件，包含标题、副标题和操作按钮区域\n⚠️ 始终提供 parentId 以确保精确定位。不指定 width 时使用 HUG 自适应。',
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
        x: { type: 'number', description: '创建时的 X 坐标（父容器内的绝对位置）' },
        y: { type: 'number', description: '创建时的 Y 坐标（父容器内的绝对位置）' },
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
    description: '创建 Hero 区域组件，包含标题、副标题和 CTA 按钮\n⚠️ 如果已知内部元素尺寸，先调用 calculate_layout 计算 hero section 所需尺寸。\n始终提供 parentId 以确保精确定位。',
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
        x: { type: 'number', description: '创建时的 X 坐标（父容器内的绝对位置）' },
        y: { type: 'number', description: '创建时的 Y 坐标（父容器内的绝对位置）' },
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

  // ── 布局工具 ──
  {
    name: 'set_layout',
    description: '设置节点的 Auto Layout 属性（方向、对齐、间距、内边距等）',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID。设置 layoutSizing 属性时，节点需在 Auto Layout 父容器内才有效' },
        direction: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'], description: '布局方向' },
        counterAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX'], description: '交叉轴对齐方式' },
        primaryAxisAlignItems: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'], description: '主轴对齐方式' },
        paddingLeft: { type: 'number', description: '左内边距' },
        paddingRight: { type: 'number', description: '右内边距' },
        paddingTop: { type: 'number', description: '上内边距' },
        paddingBottom: { type: 'number', description: '下内边距' },
        itemSpacing: { type: 'number', description: '子元素间距（主轴方向）' },
        layoutWrap: { type: 'string', enum: ['NO_WRAP', 'WRAP'], description: '换行模式' },
        counterAxisSpacing: { type: 'number', description: 'Wrap 模式下的行间距（交叉轴方向）' },
        layoutSizingHorizontal: {
          type: 'string',
          description: '子元素在主轴方向的尺寸模式。FIXED=固定尺寸, HUG=自适应内容, FILL=填满父容器。设置在父容器上时影响其自身在祖父容器中的行为',
          enum: ['FIXED', 'HUG', 'FILL'],
        },
        layoutSizingVertical: {
          type: 'string',
          description: '子元素在交叉轴方向的尺寸模式。FIXED=固定尺寸, HUG=自适应内容, FILL=填满父容器。设置在父容器上时影响其自身在祖父容器中的行为',
          enum: ['FIXED', 'HUG', 'FILL'],
        },
        layoutGrow: {
          type: 'number',
          description: '子元素是否填充父容器的剩余空间。0=不填充(默认), 1=填充。用于控制同级元素中的空间分配',
        },
        layoutAlign: {
          type: 'string',
          description: '子元素在交叉轴上的对齐拉伸行为。MIN=起始对齐, CENTER=居中, MAX=末尾对齐, STRETCH=拉伸填满交叉轴',
          enum: ['MIN', 'CENTER', 'MAX', 'STRETCH'],
        },
        layoutPreset: {
          type: 'string',
          description: '布局预设，自动应用一组预定义的布局属性。显式参数会覆盖预设值。可选值: centered(居中), stretch-fill(拉伸填满), hug-content(自适应内容), sidebar-left(左侧边栏), stack-vertical(垂直堆叠), grid-cell(网格单元格)',
          enum: ['centered', 'stretch-fill', 'hug-content', 'sidebar-left', 'stack-vertical', 'grid-cell'],
        },
      },
      required: ['nodeId'],
    },
  },

  // ── 位置工具 ──
  {
    name: 'set_position',
    description: '设置节点在画布上的绝对位置（x/y 坐标）。用于控制顶层 frame 的排列，避免重叠',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        x: { type: 'number', description: 'X 坐标（距画布左边缘的像素值）' },
        y: { type: 'number', description: 'Y 坐标（距画布上边缘的像素值）' },
      },
      required: ['nodeId'],
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
  {
    name: 'calculate_layout',
    description: `纯计算工具：根据子元素尺寸和布局参数，计算容器所需的最小尺寸。
不操作 Figma，只返回数值结果。
⚠️ 创建容器前务必先调用此工具计算正确尺寸，避免内容被裁切。
返回 { width, height, rows/columns, children 布局坐标 }。`,
    inputSchema: {
      type: 'object',
      properties: {
        children: {
          type: 'array',
          description: '子元素尺寸列表',
          items: {
            type: 'object',
            properties: {
              width: { type: 'number', description: '子元素宽度' },
              height: { type: 'number', description: '子元素高度' },
            },
            required: ['width', 'height'],
          },
        },
        direction: {
          type: 'string',
          enum: ['VERTICAL', 'HORIZONTAL'],
          description: '布局方向。VERTICAL=从上到下, HORIZONTAL=从左到右',
          default: 'VERTICAL',
        },
        layoutWrap: {
          type: 'string',
          enum: ['NO_WRAP', 'WRAP'],
          description: 'WRAP 时子元素会自动换行（需配合 maxWidth 使用）',
          default: 'NO_WRAP',
        },
        maxWidth: {
          type: 'number',
          description: '容器最大宽度。WRAP 模式下必须指定，用于计算换行',
        },
        padding: {
          type: 'number',
          description: '四边统一内边距',
          default: 0,
        },
        paddingTop: { type: 'number', description: '上内边距（覆盖 padding）' },
        paddingBottom: { type: 'number', description: '下内边距（覆盖 padding）' },
        paddingLeft: { type: 'number', description: '左内边距（覆盖 padding）' },
        paddingRight: { type: 'number', description: '右内边距（覆盖 padding）' },
        itemSpacing: {
          type: 'number',
          description: '主轴方向子元素间距',
          default: 0,
        },
        counterAxisSpacing: {
          type: 'number',
          description: '交叉轴方向间距（WRAP 模式的行间距）',
          default: 0,
        },
      },
      required: ['children'],
    },
  },
  {
    name: 'fit_to_children',
    description: `自动调整容器尺寸以完美适配其所有子元素。
读取所有子元素的 bounds，计算包围盒，然后 resize 容器。
支持可选的 padding、最大尺寸限制、以及缩小模式。
⚠️ 创建容器后发现尺寸不合适时使用此工具修复。`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: '要调整的容器节点 ID',
        },
        padding: {
          type: 'number',
          description: '四边统一内边距（调整后应用）',
          default: 0,
        },
        shrink: {
          type: 'boolean',
          description: 'true 时容器也可以缩小; false 时只扩大不缩小',
          default: false,
        },
        maxWidth: {
          type: 'number',
          description: '最大宽度限制',
        },
        maxHeight: {
          type: 'number',
          description: '最大高度限制',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'check_bounds',
    description: `验证容器内所有子元素是否在边界内，超出时提供诊断。
可选 autoFix=true 自动调整容器大小以包含所有子元素。
用于创建后的验证步骤，确保内容不会被 clipsContent 裁切。`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: '要检查的容器节点 ID',
        },
        autoFix: {
          type: 'boolean',
          description: 'true 时自动调整容器大小以包含溢出的子元素',
          default: false,
        },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Tool Implementations ─────────────────────────────────

/** 布局预设：每组预定义的 Auto Layout 属性组合 */
const LAYOUT_PRESETS: Record<string, Record<string, unknown>> = {
  'centered': {
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'CENTER',
  },
  'stretch-fill': {
    layoutSizingHorizontal: 'FILL',
    layoutSizingVertical: 'FILL',
  },
  'hug-content': {
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'HUG',
  },
  'sidebar-left': {
    direction: 'HORIZONTAL',
    layoutSizingVertical: 'FILL',
  },
  'stack-vertical': {
    direction: 'VERTICAL',
    itemSpacing: 8,
  },
  'grid-cell': {
    layoutSizingHorizontal: 'FILL',
    layoutSizingVertical: 'HUG',
  },
};

export class SemanticTools {
  private primitives: Primitives;
  private registry: SemanticRegistry;
  private eventQueue: PluginEvent[];
  private templateRegistry: TemplateRegistry;
  private registryHydrated = false;

  constructor(executor: PrimitiveExecutor, eventQueue: PluginEvent[] = []) {
    this.primitives = new Primitives(executor);
    this.registry = new SemanticRegistry((entry) => this.primitives.setSemanticData({ nodeId: entry.nodeId, entry }));
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

        // ── 曲线与矢量工具 ──
        case 'import_svg':
          return await this.importSvg(params);
        case 'create_path':
          return await this.createPath(params);
        case 'create_arc':
          return await this.createArc(params);
        case 'create_wave':
          return await this.createWave(params);
        case 'create_bezier_curve':
          return await this.createBezierCurve(params);
        case 'create_custom_shape':
          return await this.createCustomShape(params);
        case 'trace_image':
          return await this.traceImage(params);

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
        case 'set_layout':
          return await this.setLayout(params);
        case 'set_position':
          return await this.setPosition(params);
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

        // ── Layout Calculation 工具 ──
        case 'calculate_layout':
          return this.calculateLayout(params);

        // ── Layout Validation 工具 ──
        case 'fit_to_children':
          return await this.fitToChildren(params);
        case 'check_bounds':
          return await this.checkBounds(params);

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
      layoutPreset, layoutWrap, counterAxisSpacing, clipsContent,
      horizontalSizing, verticalSizing,
    } = params as Record<string, unknown>;

    const fills = parseFills(fill as string | undefined);

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

    const node = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: width as number | undefined,
      height: height as number | undefined,
      fills: fills as FigmaFill[],
      cornerRadius: cornerRadius as number | undefined,
      x,
      y,
    });

    // 合并布局预设与显式参数（显式参数优先）
    const p = typeof padding === 'number' ? padding : 0;
    const g = typeof gap === 'number' ? gap : 0;
    const defaultHorizontalSizing = (horizontalSizing as SetLayoutParams['layoutSizingHorizontal'] | undefined)
      ?? (width !== undefined ? 'FIXED' : 'HUG');
    const defaultVerticalSizing = (verticalSizing as SetLayoutParams['layoutSizingVertical'] | undefined)
      ?? (height !== undefined ? 'FIXED' : 'HUG');
    const preset = layoutPreset ? LAYOUT_PRESETS[layoutPreset as string] : undefined;
    const layoutArgs = {
      ...(preset || {}),
      nodeId: node.id,
      direction: (direction as 'VERTICAL' | 'HORIZONTAL') || 'VERTICAL',
      paddingLeft: p,
      paddingRight: p,
      paddingTop: p,
      paddingBottom: p,
      itemSpacing: g,
      // WRAP 模式支持
      ...(layoutWrap !== undefined && { layoutWrap: layoutWrap as 'NO_WRAP' | 'WRAP' }),
      ...(counterAxisSpacing !== undefined && { counterAxisSpacing: counterAxisSpacing as number }),
      layoutSizingHorizontal: defaultHorizontalSizing,
      layoutSizingVertical: defaultVerticalSizing,
    } as SetLayoutParams;

    // create_container 始终创建 Auto Layout；尺寸策略决定 FIXED/HUG/FILL。
    await this.primitives.setLayout(layoutArgs);

    // 设置 clipsContent（如果有指定）
    if (clipsContent !== undefined) {
      await this.primitives.setProperties({
        nodeId: node.id,
        properties: { clipsContent },
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

    return {
      success: true,
      data: {
        ...node,
        semantic: semanticType,
        sizing: { horizontal: defaultHorizontalSizing, vertical: defaultVerticalSizing },
      },
    };
  }

  private async createText(params: Record<string, unknown>): Promise<SemanticResult> {
    const { content, name, semantic, fontSize, fontWeight, fontFamily, color, parentId } = params;

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

    const node = await this.primitives.createTextNode({
      content: content as string,
      name: (name as string) || 'Text',
      parentId: parentId as string | undefined,
      fontSize: fontSize as number | undefined,
      fontWeight: fontWeight as string | undefined,
      fontFamily: fontFamily as string | undefined,
      color: parseColor(color as string | undefined),
      x,
      y,
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

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

    // 创建按钮容器
    const btn = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      fills: parseFills(btnColor),
      cornerRadius: (params.borderRadius as number) ?? 6,
      x,
      y,
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
    let cornerRadius = (params.borderRadius as number) ?? 8;
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

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

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
      x,
      y,
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

    if (imageUrl && typeof imageUrl === 'string') {
      await this.primitives.createImageNode({
        imageData: await this.loadImageData(imageUrl),
        name: 'Avatar Image', parentId: avatar.id,
        width: size as number, height: size as number,
        cornerRadius: shape === 'circle' ? (size as number) / 2 : 4,
      });
    }

    // 显示回退文字
    if (!imageUrl && fallbackText && typeof fallbackText === 'string') {
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

  /** 内置 SVG 图标库（24x24 viewBox，线性风格） */
  private static readonly ICON_SVGS: Record<string, string> = {
    'arrow': '<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'check': '<path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'close': '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    'search': '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="2" fill="none"/>',
    'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
    'plus': '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    'minus': '<path d="M5 12h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    'chevron-right': '<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'chevron-up': '<path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
    'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" fill="none"/>',
    'home': '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" stroke-width="2" fill="none"/>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2" fill="none"/>',
    'mail': '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="22,6 12,13 2,6" stroke="currentColor" stroke-width="2" fill="none"/>',
    'trash': '<polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none"/>',
    'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" fill="none"/>',
    'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" fill="none"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" fill="none"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" fill="none"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="17 8 12 3 7 8" stroke="currentColor" stroke-width="2" fill="none"/><line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" stroke-width="2" fill="none"/>',
    'share': '<circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="2" fill="none"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="currentColor" stroke-width="2" fill="none"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="currentColor" stroke-width="2" fill="none"/>',
    'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" stroke="currentColor" stroke-width="2" fill="none"/>',
    'sort': '<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="19 12 12 19 5 12" stroke="currentColor" stroke-width="2" fill="none"/>',
    'refresh': '<polyline points="23 4 23 10 17 10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" stroke="currentColor" stroke-width="2" fill="none"/>',
    'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="2" fill="none"/>',
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2" fill="none"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2" fill="none"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2" fill="none"/>',
    'clock': '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2" fill="none"/>',
  };

  private async createIcon(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, icon, iconName, svg, size = 24, color = '#374151', parentId, x, y } = params;

    // 优先级: svg > iconName > icon (文本占位)
    if (svg && typeof svg === 'string') {
      const node = await this.primitives.createFromSvg({
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${svg}</svg>`,
        name: name as string,
        parentId: parentId as string | undefined,
        x: x as number | undefined,
        y: y as number | undefined,
      });

      const entry: SemanticEntry = {
        nodeId: node.id, type: 'icon', name: name as string,
        createdAt: Date.now(), parentId: parentId as string | undefined,
        metadata: { icon: 'custom-svg', size },
      };
      this.registry.register(entry);
      return { success: true, data: { ...node, semantic: 'icon' } };
    }

    if (iconName && typeof iconName === 'string' && SemanticTools.ICON_SVGS[iconName]) {
      const colorStr = this.hexToSvgColor(color as string);
      const paths = SemanticTools.ICON_SVGS[iconName].replace(/currentColor/g, colorStr);

      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${paths}</svg>`;

      const node = await this.primitives.createFromSvg({
        svg: svgStr,
        name: name as string,
        parentId: parentId as string | undefined,
        x: x as number | undefined,
        y: y as number | undefined,
      });

      const entry: SemanticEntry = {
        nodeId: node.id, type: 'icon', name: name as string,
        createdAt: Date.now(), parentId: parentId as string | undefined,
        metadata: { iconName, size },
      };
      this.registry.register(entry);
      return { success: true, data: { ...node, semantic: 'icon', iconName } };
    }

    // 兜底: 文本占位（向后兼容）
    const iconNode = await this.primitives.createTextNode({
      content: (icon as string) || '?',
      name: name as string,
      parentId: parentId as string | undefined,
      fontSize: size as number,
      color: parseColor((color as string) || '#374151'),
    });

    const entry: SemanticEntry = {
      nodeId: iconNode.id, type: 'icon', name: name as string,
      createdAt: Date.now(), parentId: parentId as string | undefined,
      metadata: { icon, size },
    };
    this.registry.register(entry);
    return { success: true, data: { ...iconNode, semantic: 'icon' } };
  }

  /** 将 hex 颜色转换为 CSS rgb() 格式（用于 SVG 内联样式） */
  private hexToSvgColor(hex: string): string {
    const c = hexToRgb(hex);
    return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  }

  /** 将点数组转换为 SVG path d 属性 */
  private pointsToSvgPath(
    points: Array<{ x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } }>,
    closed: boolean,
  ): string {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const hOut = prev.handleOut || { x: 0, y: 0 };
      const hIn = curr.handleIn || { x: 0, y: 0 };
      if (hOut.x !== 0 || hOut.y !== 0 || hIn.x !== 0 || hIn.y !== 0) {
        d += ` C ${prev.x + hOut.x} ${prev.y + hOut.y} ${curr.x + hIn.x} ${curr.y + hIn.y} ${curr.x} ${curr.y}`;
      } else {
        d += ` L ${curr.x} ${curr.y}`;
      }
    }
    if (closed && points.length > 1) {
      const last = points[points.length - 1];
      const first = points[0];
      const hOut = last.handleOut || { x: 0, y: 0 };
      const hIn = first.handleIn || { x: 0, y: 0 };
      if (hOut.x !== 0 || hOut.y !== 0 || hIn.x !== 0 || hIn.y !== 0) {
        d += ` C ${last.x + hOut.x} ${last.y + hOut.y} ${first.x + hIn.x} ${first.y + hIn.y} ${first.x} ${first.y}`;
      }
      d += ' Z';
    }
    return d;
  }

  /** 构建完整 SVG 字符串（含 viewBox 计算） */
  private buildSvgString(d: string, style: string, pad: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): string {
    const vbX = bounds.minX - pad;
    const vbY = bounds.minY - pad;
    const vbW = (bounds.maxX - bounds.minX) + pad * 2;
    const vbH = (bounds.maxY - bounds.minY) + pad * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}"><path d="${d}" style="${style}" /></svg>`;
  }

  private async importSvg(params: Record<string, unknown>): Promise<SemanticResult> {
    const { svg, name, semantic, parentId, x, y } = params;

    if (!svg || typeof svg !== 'string') {
      return { success: false, error: 'svg parameter is required and must be a string' };
    }

    const node = await this.primitives.createFromSvg({
      svg: svg as string,
      name: (name as string) || 'SVG Import',
      parentId: parentId as string | undefined,
      x: x as number | undefined,
      y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'svg-import';
    this.registry.register({
      nodeId: node.id,
      type: semanticType,
      name: (name as string) || 'SVG Import',
      createdAt: Date.now(),
      parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  private async createPath(params: Record<string, unknown>): Promise<SemanticResult> {
    const { points, closed = false, strokeColor, strokeWidth = 1, fillColor, name, semantic, parentId, x, y } = params;

    if (!Array.isArray(points) || points.length < 2) {
      return { success: false, error: 'points must be an array with at least 2 points' };
    }

    const pts = points as Array<{ x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } }>;
    const d = this.pointsToSvgPath(pts, closed as boolean);

    // Build styles
    const sc = strokeColor ? this.hexToSvgColor(strokeColor as string) : 'rgb(0,0,0)';
    const strokeStyle = `stroke:${sc};stroke-width:${strokeWidth};stroke-linecap:round;stroke-linejoin:round;`;
    const fillStyle = fillColor ? `fill:${this.hexToSvgColor(fillColor as string)};` : 'fill:none;';

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }

    const svg = this.buildSvgString(d, strokeStyle + fillStyle, strokeWidth as number + 2, { minX, minY, maxX, maxY });

    const node = await this.primitives.createFromSvg({
      svg,
      name: (name as string) || 'Path',
      parentId: parentId as string | undefined,
      x: x as number | undefined,
      y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'path';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Path',
      createdAt: Date.now(), parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType, pathData: d } };
  }

  private async createArc(params: Record<string, unknown>): Promise<SemanticResult> {
    const { cx = 0, cy = 0, radius = 50, startAngle = 0, endAngle = 180,
      strokeColor = '#000000', strokeWidth = 2, fillColor, name, semantic, parentId, x, y } = params;

    const startRad = ((startAngle as number) * Math.PI) / 180;
    const endRad = ((endAngle as number) * Math.PI) / 180;
    const r = radius as number;
    const _cx = cx as number, _cy = cy as number;

    const x1 = _cx + r * Math.cos(startRad);
    const y1 = _cy + r * Math.sin(startRad);
    const x2 = _cx + r * Math.cos(endRad);
    const y2 = _cy + r * Math.sin(endRad);

    const angleDiff = Math.abs(endRad - startRad);
    const largeArc = angleDiff > Math.PI ? 1 : 0;

    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;

    const sc = this.hexToSvgColor(strokeColor as string);
    let style = `stroke:${sc};stroke-width:${strokeWidth};stroke-linecap:round;fill:none;`;
    if (fillColor) {
      style = `stroke:${sc};stroke-width:${strokeWidth};stroke-linecap:round;fill:${this.hexToSvgColor(fillColor as string)};`;
    }

    const svg = this.buildSvgString(d, style, (strokeWidth as number) + 2, {
      minX: _cx - r, minY: _cy - r, maxX: _cx + r, maxY: _cy + r,
    });

    const node = await this.primitives.createFromSvg({
      svg, name: (name as string) || 'Arc', parentId: parentId as string | undefined,
      x: x as number | undefined, y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'arc';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Arc',
      createdAt: Date.now(), parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  private async createWave(params: Record<string, unknown>): Promise<SemanticResult> {
    const { width = 200, amplitude = 20, frequency = 2, strokeWidth = 2,
      strokeColor = '#000000', fillColor, filled = false, name, semantic, parentId, x, y } = params;

    const w = width as number, a = amplitude as number, f = frequency as number;
    const steps = Math.max(20, f * 20);
    const stepW = w / steps;

    let d = '';
    for (let i = 0; i <= steps; i++) {
      const x = i * stepW;
      const y = a * Math.sin((2 * Math.PI * f * i) / steps);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }

    if (filled) {
      d += ` L ${w} 0 L 0 0 Z`;
    }

    const sc = this.hexToSvgColor(strokeColor as string);
    const fillVal = fillColor ? `fill:${this.hexToSvgColor(fillColor as string)};` : 'fill:none;';
    const style = `stroke:${sc};stroke-width:${strokeWidth};stroke-linecap:round;stroke-linejoin:round;${fillVal}`;

    const svg = this.buildSvgString(d, style, (strokeWidth as number) + a, {
      minX: 0, minY: -a, maxX: w, maxY: a,
    });

    const node = await this.primitives.createFromSvg({
      svg, name: (name as string) || 'Wave', parentId: parentId as string | undefined,
      x: x as number | undefined, y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'wave';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Wave',
      createdAt: Date.now(), parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  private async createBezierCurve(params: Record<string, unknown>): Promise<SemanticResult> {
    const { x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y,
      strokeColor = '#000000', strokeWidth = 2, name, semantic, parentId, x, y } = params;

    const _x1 = x1 as number, _y1 = y1 as number, _x2 = x2 as number, _y2 = y2 as number;
    const _cp1x = (cp1x as number) ?? _x1 + (_x2 - _x1) * 0.3;
    const _cp1y = (cp1y as number) ?? _y1;
    const _cp2x = (cp2x as number) ?? _x2 - (_x2 - _x1) * 0.3;
    const _cp2y = (cp2y as number) ?? _y2;

    const d = `M ${_x1} ${_y1} C ${_cp1x} ${_cp1y} ${_cp2x} ${_cp2y} ${_x2} ${_y2}`;

    const sc = this.hexToSvgColor(strokeColor as string);
    const style = `stroke:${sc};stroke-width:${strokeWidth};fill:none;stroke-linecap:round;`;

    const allX = [_x1, _x2, _cp1x, _cp2x];
    const allY = [_y1, _y2, _cp1y, _cp2y];

    const svg = this.buildSvgString(d, style, (strokeWidth as number) + 2, {
      minX: Math.min(...allX), minY: Math.min(...allY),
      maxX: Math.max(...allX), maxY: Math.max(...allY),
    });

    const node = await this.primitives.createFromSvg({
      svg, name: (name as string) || 'Bezier Curve', parentId: parentId as string | undefined,
      x: x as number | undefined, y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'bezier-curve';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Bezier Curve',
      createdAt: Date.now(), parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType, pathData: d } };
  }

  private async createCustomShape(params: Record<string, unknown>): Promise<SemanticResult> {
    const { points, fillColor = '#E5E7EB', strokeColor, strokeWidth = 0, name, semantic, parentId, x, y } = params;

    if (!Array.isArray(points) || points.length < 3) {
      return { success: false, error: 'points must be an array with at least 3 points for a closed shape' };
    }

    const pts = points as Array<{ x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } }>;
    const d = this.pointsToSvgPath(pts, true);

    const fillVal = `fill:${this.hexToSvgColor(fillColor as string)};`;
    const strokeVal = strokeColor ? `stroke:${this.hexToSvgColor(strokeColor as string)};stroke-width:${strokeWidth};` : '';
    const style = fillVal + strokeVal + 'stroke-linecap:round;stroke-linejoin:round;';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }

    const svg = this.buildSvgString(d, style, (strokeWidth as number) + 2, { minX, minY, maxX, maxY });

    const node = await this.primitives.createFromSvg({
      svg, name: (name as string) || 'Custom Shape', parentId: parentId as string | undefined,
      x: x as number | undefined, y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'custom-shape';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Custom Shape',
      createdAt: Date.now(), parentId: parentId as string | undefined,
    });

    return { success: true, data: { ...node, semantic: semanticType } };
  }

  private async traceImage(params: Record<string, unknown>): Promise<SemanticResult> {
    const { imageData, filePath, colors = 8, pathPrecision = 3, simplify = true, scale = 1, name, semantic, parentId, x, y } = params;

    let ImageTracer: any;
    let PNGReader: any;
    try {
      ImageTracer = (await import('imagetracerjs')).default;
      PNGReader = (await import('imagetracerjs/nodecli/PNGReader.js')).default;
    } catch {
      return { success: false, error: 'imagetracerjs is not installed. Run: pnpm add imagetracerjs' };
    }

    if (!imageData && !filePath) {
      return { success: false, error: 'Either imageData (base64) or filePath is required' };
    }

    let pngBytes: Buffer;
    if (filePath) {
      const fs = await import('fs');
      pngBytes = fs.readFileSync(filePath as string);
    } else {
      pngBytes = Buffer.from(imageData as string, 'base64');
    }

    // 解析 PNG
    const reader = new PNGReader(pngBytes);
    const png = await new Promise<any>((resolve, reject) => {
      reader.parse((err: any, png: any) => {
        if (err) reject(err);
        else resolve(png);
      });
    });

    const imgd = { width: png.width, height: png.height, data: png.pixels };

    // 追踪为 SVG
    const ltres = 1 / (pathPrecision as number);
    const qtres = 1 / (pathPrecision as number);
    const svgStr = ImageTracer.imagedataToSVG(imgd, {
      numberofcolors: colors as number,
      pathomit: simplify ? 3 : 0,
      ltres,
      qtres,
      scale: scale as number,
      strokewidth: 0,
      linefilter: true,
      roundcoords: 1,
      viewbox: true,
    });

    // 导入到 Figma
    const node = await this.primitives.createFromSvg({
      svg: svgStr,
      name: (name as string) || 'Traced Image',
      parentId: parentId as string | undefined,
      x: x as number | undefined,
      y: y as number | undefined,
    });

    const semanticType = (semantic as string) || 'traced-image';
    this.registry.register({
      nodeId: node.id, type: semanticType, name: (name as string) || 'Traced Image',
      createdAt: Date.now(), parentId: parentId as string | undefined,
      metadata: { colors, pathPrecision, scale, originalWidth: png.width, originalHeight: png.height },
    });

    return { success: true, data: { ...node, semantic: semanticType, originalSize: { width: png.width, height: png.height } } };
  }

  private async createImage(params: Record<string, unknown>): Promise<SemanticResult> {
    const { name, width, height, src, cornerRadius, parentId } = params;
    const img = src && typeof src === 'string'
      ? await this.primitives.createImageNode({
          imageData: await this.loadImageData(src), name: name as string,
          parentId: parentId as string | undefined, width: width as number,
          height: height as number, cornerRadius: cornerRadius as number | undefined,
        })
      : await this.primitives.createNode({
          type: 'RECTANGLE', name: name as string, parentId: parentId as string | undefined,
          width: width as number, height: height as number, fills: parseFills('#E5E7EB'),
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

  private async ensureRegistryHydrated(): Promise<void> {
    if (this.registryHydrated) return;
    const entries = await this.primitives.getSemanticEntries();
    for (const entry of entries) this.registry.register(entry, false);
    this.registryHydrated = true;
  }

  private async loadImageData(src: string): Promise<string> {
    if (src.startsWith('data:')) {
      const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(src);
      if (!match) throw new Error('Unsupported or malformed image data URL');
      if (Buffer.byteLength(match[1], 'base64') > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MB');
      return match[1];
    }
    const url = new URL(src);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Image URL must use http or https');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`URL is not an image: ${contentType || 'unknown content type'}`);
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MB');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MB');
      return bytes.toString('base64');
    } finally {
      clearTimeout(timer);
    }
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

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

    const header = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || 800,
      fills: parseFills((fill as string) || '#FFFFFF'),
      x,
      y,
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

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;

    const hero = await this.primitives.createNode({
      type: 'FRAME',
      name: name as string,
      parentId: parentId as string | undefined,
      width: (width as number) || 800,
      height: (height as number) || 400,
      fills: parseFills((fill as string) || '#F9FAFB'),
      x,
      y,
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
      await this.ensureRegistryHydrated();
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
    await this.ensureRegistryHydrated();
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
          processedProps[key === 'color' ? 'fills' : key] = parseFills(value);
        } else {
          processedProps[key] = value;
        }
      }
    }

    const data = await this.primitives.setProperties({
      nodeId: nodeId as string,
      properties: processedProps,
    });
    // 返回更新后的属性摘要（包含位置信息）
    const result = data as Record<string, unknown> | undefined;
    return {
      success: true,
      data: {
        ...result,
        nodeId,
        updatedKeys: Object.keys(processedProps),
      },
    };
  }

  private async updateBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    await this.ensureRegistryHydrated();
    const { semantic, properties, filter } = params;

    const entries = this.registry.findAll(
      filter ? { ...(filter as Record<string, string>), type: semantic as string } : { type: semantic as string }
    );

    const results: unknown[] = [];
    const processedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      if ((key === 'fills' || key === 'color') && typeof value === 'string') {
        processedProps[key === 'color' ? 'fills' : key] = parseFills(value);
      } else {
        processedProps[key] = value;
      }
    }
    for (const entry of entries) {
      const data = await this.primitives.setProperties({
        nodeId: entry.nodeId,
        properties: processedProps,
      });
      results.push(data);
    }

    return {
      success: true,
      data: { updated: results.length, results },
    };
  }

  private async setLayout(params: Record<string, unknown>): Promise<SemanticResult> {
    const nodeId = params.nodeId as string;

    // 应用布局预设（显式参数优先）
    let merged = { ...params };
    if (params.layoutPreset && typeof params.layoutPreset === 'string') {
      const preset = LAYOUT_PRESETS[params.layoutPreset];
      if (preset) {
        merged = { ...preset, ...params };  // 显式参数覆盖预设
      }
    }

    const { nodeId: _id, layoutPreset: _preset, direction, paddingLeft, paddingRight, paddingTop, paddingBottom, itemSpacing, counterAxisAlignItems, primaryAxisAlignItems, layoutWrap, counterAxisSpacing, layoutSizingHorizontal, layoutSizingVertical, layoutGrow, layoutAlign } = merged;

    await this.primitives.setLayout({
      nodeId,
      direction: direction as 'NONE' | 'HORIZONTAL' | 'VERTICAL' | undefined,
      counterAxisAlignItems: counterAxisAlignItems as 'MIN' | 'CENTER' | 'MAX' | undefined,
      primaryAxisAlignItems: primaryAxisAlignItems as 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | undefined,
      paddingLeft: paddingLeft as number | undefined,
      paddingRight: paddingRight as number | undefined,
      paddingTop: paddingTop as number | undefined,
      paddingBottom: paddingBottom as number | undefined,
      itemSpacing: itemSpacing as number | undefined,
      layoutWrap: layoutWrap as 'NO_WRAP' | 'WRAP' | undefined,
      counterAxisSpacing: counterAxisSpacing as number | undefined,
      layoutSizingHorizontal: layoutSizingHorizontal as 'FIXED' | 'HUG' | 'FILL' | undefined,
      layoutSizingVertical: layoutSizingVertical as 'FIXED' | 'HUG' | 'FILL' | undefined,
      layoutGrow: layoutGrow as number | undefined,
      layoutAlign: layoutAlign as 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | undefined,
    });

    const appliedPreset = params.layoutPreset ? ` (preset: ${params.layoutPreset})` : '';
    return { success: true, data: { updated: true, nodeId, message: `Layout updated for ${nodeId}${appliedPreset}` } };
  }

  private async setPosition(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId, x, y } = params;
    const properties: Record<string, unknown> = {};
    if (x !== undefined) properties.x = x;
    if (y !== undefined) properties.y = y;

    await this.primitives.setProperties({
      nodeId: nodeId as string,
      properties,
    });

    return {
      success: true,
      data: { nodeId, x: x ?? 'unchanged', y: y ?? 'unchanged' },
    };
  }

  private async deleteNode(params: Record<string, unknown>): Promise<SemanticResult> {
    const { nodeId } = params;

    await this.primitives.deleteNode({ nodeId: nodeId as string });
    this.registry.unregister(nodeId as string);

    return { success: true, data: { deleted: nodeId } };
  }

  private async deleteBySemantic(params: Record<string, unknown>): Promise<SemanticResult> {
    await this.ensureRegistryHydrated();
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
    await this.ensureRegistryHydrated();
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
    await this.ensureRegistryHydrated();
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
          let rolledBackCount = 0;
          for (let i = createdNodeIds.length - 1; i >= 0; i--) {
            try {
              await this.primitives.deleteNode({ nodeId: createdNodeIds[i] });
              this.registry.unregister(createdNodeIds[i]);
              rolledBackCount++;
            } catch (rErr) {
              rollbackErrors.push(`${createdNodeIds[i]}: ${rErr instanceof Error ? rErr.message : String(rErr)}`);
            }
          }
          return {
            success: false,
            error: `Batch failed at step ${results.length - 1} (${c.tool}): ${result.error}. Rolled back ${createdNodeIds.length} nodes.`,
            data: { results, executed: results.length, total: commands.length, rolledBack: true, rolledBackCount, rollbackErrors },
          };
        }
        break;
      }
    }

    const allSuccess = results.every(r => r.result.success);

    // 收集成功创建的节点信息并获取结构摘要
    const createdNodes: Array<{ id: string; name: string; type: string; childCount: number }> = [];
    for (const r of results) {
      if (r.result.success && r.result.data && typeof r.result.data === 'object') {
        const data = r.result.data as Record<string, unknown>;
        if (data.id && typeof data.id === 'string') {
          try {
            const tree = await this.primitives.getNodeTree({ nodeId: data.id as string, depth: 1 }) as Record<string, unknown>;
            createdNodes.push({
              id: data.id as string,
              name: (tree.name as string) || (data.name as string) || 'unknown',
              type: (tree.type as string) || (data.type as string) || 'unknown',
              childCount: Array.isArray(tree.children) ? tree.children.length : 0,
            });
          } catch {
            createdNodes.push({
              id: data.id as string,
              name: (data.name as string) || 'unknown',
              type: (data.type as string) || 'unknown',
              childCount: 0,
            });
          }
        }
      }
    }

    return {
      success: allSuccess,
      data: {
        results,
        summary: {
          totalCommands: commands.length,
          succeeded: results.filter(r => r.result.success).length,
          failed: results.filter(r => !r.result.success).length,
          createdNodes,
        },
      },
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
          const layoutKeys = new Set(['layoutMode', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing']);
          const layoutProps: Record<string, unknown> = {};
          const regularProps: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(diff.properties)) {
            (layoutKeys.has(key) ? layoutProps : regularProps)[key] = value;
          }
          if (Object.keys(regularProps).length) {
            await this.primitives.setProperties({ nodeId: diff.id, properties: regularProps });
          }
          if (Object.keys(layoutProps).length) {
            await this.primitives.setLayout({
              nodeId: diff.id,
              direction: layoutProps.layoutMode as SetLayoutParams['direction'],
              paddingLeft: layoutProps.paddingLeft as number | undefined,
              paddingRight: layoutProps.paddingRight as number | undefined,
              paddingTop: layoutProps.paddingTop as number | undefined,
              paddingBottom: layoutProps.paddingBottom as number | undefined,
              itemSpacing: layoutProps.itemSpacing as number | undefined,
            });
          }
          applied.push(`modify:${diff.id}`);
        } else if (diff.type === 'add' && diff.snapshot) {
          await this.createSnapshotTree(diff.snapshot, diff.parentId || parentId);
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

    if (current.name !== target.name) {
      changedProps.name = target.name;
      hasChanges = true;
    }

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
          snapshot: tc,
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

  private async createSnapshotTree(snapshot: NodeSnapshot, parentId?: string): Promise<string> {
    let created: { id: string };
    if (snapshot.type === 'TEXT') {
      const fontName = snapshot.properties.fontName as { family?: string; style?: string } | undefined;
      created = await this.primitives.createTextNode({
        content: String(snapshot.properties.characters ?? ''), name: snapshot.name, parentId,
        fontFamily: fontName?.family, fontWeight: fontName?.style,
        fontSize: typeof snapshot.properties.fontSize === 'number' ? snapshot.properties.fontSize : undefined,
        x: snapshot.properties.x as number | undefined, y: snapshot.properties.y as number | undefined,
      });
    } else {
      const supported = new Set(['FRAME', 'RECTANGLE', 'ELLIPSE', 'LINE', 'COMPONENT', 'VECTOR', 'STAR', 'POLYGON']);
      if (!supported.has(snapshot.type)) throw new Error(`Diff cannot recreate node type: ${snapshot.type}`);
      created = await this.primitives.createNode({
        type: snapshot.type as 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'VECTOR' | 'STAR' | 'POLYGON',
        name: snapshot.name, parentId,
        ...snapshot.properties,
      });
    }
    for (const child of snapshot.children || []) await this.createSnapshotTree(child, created.id);
    return created.id;
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

  // ─── Layout Calculation Tools ──────────────────────────────────

  private calculateLayout(params: Record<string, unknown>): SemanticResult {
    const children = params.children as Array<{ width: number; height: number }>;
    const direction = (params.direction as string) || 'VERTICAL';
    const layoutWrap = (params.layoutWrap as string) || 'NO_WRAP';
    const maxWidth = params.maxWidth as number | undefined;
    const itemSpacing = (params.itemSpacing as number) || 0;
    const counterAxisSpacing = (params.counterAxisSpacing as number) || 0;

    // Resolve padding
    const pt = (params.paddingTop as number) ?? (params.padding as number) ?? 0;
    const pb = (params.paddingBottom as number) ?? (params.padding as number) ?? 0;
    const pl = (params.paddingLeft as number) ?? (params.padding as number) ?? 0;
    const pr = (params.paddingRight as number) ?? (params.padding as number) ?? 0;

    if (!children || children.length === 0) {
      return { success: true, data: { width: pl + pr, height: pt + pb, rows: 0, columns: 0, childCount: 0, layout: [] } };
    }

    const layout: Array<{ index: number; x: number; y: number; width: number; height: number }> = [];

    if (layoutWrap === 'WRAP') {
      // ─── WRAP mode ───
      // maxWidth 是容器总宽，内容区 = maxWidth - paddingLeft - paddingRight
      const effectiveMaxWidth = (maxWidth ?? Infinity) - pl - pr;
      const rows: Array<Array<{ index: number; width: number; height: number }>> = [[]];
      let currentRowWidth = 0;
      let currentRowIdx = 0;
      let hasOverflow = false;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];

        // Check if this child needs a new row (before calculating neededWidth for current row)
        const needsNewRow = rows[currentRowIdx].length > 0
          && currentRowWidth + child.width + itemSpacing > effectiveMaxWidth;

        if (needsNewRow) {
          // Start new row
          currentRowIdx++;
          rows.push([]);
          currentRowWidth = 0;
        }

        // First item in row: no spacing; subsequent items: add itemSpacing
        const neededWidth = rows[currentRowIdx].length === 0
          ? child.width
          : child.width + itemSpacing;

        // Flag overflow: child alone exceeds content area width
        if (child.width > effectiveMaxWidth) {
          hasOverflow = true;
        }

        rows[currentRowIdx].push({ index: i, width: child.width, height: child.height });
        currentRowWidth += neededWidth;
      }

      // Calculate layout positions
      let yOffset = pt;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        let xOffset = pl;
        const rowMaxHeight = Math.max(...row.map(c => c.height));

        for (const cell of row) {
          layout.push({
            index: cell.index,
            x: xOffset,
            y: yOffset,
            width: cell.width,
            height: cell.height,
          });
          xOffset += cell.width + itemSpacing;
        }
        yOffset += rowMaxHeight + (r < rows.length - 1 ? counterAxisSpacing : 0);
      }
      yOffset += pb;

      const totalWidth = Math.max(
        ...rows.map(row => row.reduce((sum, c, i) => sum + c.width + (i > 0 ? itemSpacing : 0), 0))
      ) + pl + pr;
      const totalHeight = yOffset;

      return {
        success: true,
        data: {
          width: Math.ceil(totalWidth),
          height: Math.ceil(totalHeight),
          rows: rows.length,
          columns: Math.max(...rows.map(r => r.length)),
          childCount: children.length,
          ...(hasOverflow && { overflow: true, overflowMessage: '存在子元素宽度超出容器内容区，将被裁切' }),
          layout,
        },
      };
    }

    // ─── NO_WRAP mode ───
    if (direction === 'VERTICAL') {
      let totalHeight = pt;
      let maxWidthChild = 0;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        layout.push({
          index: i,
          x: pl,
          y: totalHeight,
          width: child.width,
          height: child.height,
        });
        maxWidthChild = Math.max(maxWidthChild, child.width);
        totalHeight += child.height + (i < children.length - 1 ? itemSpacing : 0);
      }
      totalHeight += pb;

      return {
        success: true,
        data: {
          width: Math.ceil(maxWidthChild + pl + pr),
          height: Math.ceil(totalHeight),
          columns: 1,
          rows: children.length,
          childCount: children.length,
          layout,
        },
      };
    } else {
      // HORIZONTAL
      let totalWidth = pl;
      let maxHeightChild = 0;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        layout.push({
          index: i,
          x: totalWidth,
          y: pt,
          width: child.width,
          height: child.height,
        });
        maxHeightChild = Math.max(maxHeightChild, child.height);
        totalWidth += child.width + (i < children.length - 1 ? itemSpacing : 0);
      }
      totalWidth += pr;

      return {
        success: true,
        data: {
          width: Math.ceil(totalWidth),
          height: Math.ceil(maxHeightChild + pt + pb),
          columns: children.length,
          rows: 1,
          childCount: children.length,
          layout,
        },
      };
    }
  }

  // ─── Layout Validation Tools ──────────────────────────────────

  private async fitToChildren(params: Record<string, unknown>): Promise<SemanticResult> {
    const nodeId = params.nodeId as string;
    const padding = (params.padding as number) ?? 0;
    const shrink = (params.shrink as boolean) ?? false;
    const maxWidth = params.maxWidth as number | undefined;
    const maxHeight = params.maxHeight as number | undefined;

    // Get current node info to get original width/height for shrink check
    const currentInfo = await this.primitives.getNodeProperties({
      nodeId,
      properties: ['width', 'height'],
    }) as Record<string, unknown>;
    // getNodeProperties returns { id, type, width, height, ... } directly
    const currentWidth = (currentInfo?.width as number) ?? 0;
    const currentHeight = (currentInfo?.height as number) ?? 0;

    // Get all children with their bounds
    const tree = await this.primitives.getNodeTree({ nodeId, depth: 1 }) as Record<string, unknown>;
    const children = tree?.children as Array<Record<string, unknown>> | undefined;

    if (!children || children.length === 0) {
      return { success: true, data: { nodeId, width: currentWidth, height: currentHeight, message: '无子元素，无需调整' } };
    }

    // Get bounds for each child
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasError = false;
    const errors: string[] = [];

    for (const child of children) {
      try {
        const childProps = await this.primitives.getNodeProperties({
          nodeId: child.id as string,
          properties: ['x', 'y', 'width', 'height'],
        }) as Record<string, unknown>;
        // getNodeProperties returns { id, type, x, y, width, height, ... } directly
        if (!childProps) continue;

        const x = (childProps.x as number) ?? 0;
        const y = (childProps.y as number) ?? 0;
        const w = (childProps.width as number) ?? 0;
        const h = (childProps.height as number) ?? 0;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      } catch (e) {
        errors.push(`Failed to read child ${child.id}: ${e}`);
        hasError = true;
      }
    }

    if (minX === Infinity) {
      return { success: false, error: '无法读取任何子元素的边界信息' };
    }

    // Calculate required size
    let requiredWidth = maxX - minX + padding * 2;
    let requiredHeight = maxY - minY + padding * 2;

    // Apply shrink check
    if (!shrink) {
      requiredWidth = Math.max(requiredWidth, currentWidth);
      requiredHeight = Math.max(requiredHeight, currentHeight);
    }

    // Apply max constraints
    if (maxWidth !== undefined) requiredWidth = Math.min(requiredWidth, maxWidth);
    if (maxHeight !== undefined) requiredHeight = Math.min(requiredHeight, maxHeight);

    // Round up to avoid sub-pixel issues
    requiredWidth = Math.ceil(requiredWidth);
    requiredHeight = Math.ceil(requiredHeight);

    // Resize the container
    await this.primitives.resizeNode({ nodeId, width: requiredWidth, height: requiredHeight });

    // If padding > 0 and there's offset (minX or minY > 0), we might need to adjust children
    // For now, just resize the container
    return {
      success: true,
      data: {
        nodeId,
        width: requiredWidth,
        height: requiredHeight,
        previousWidth: currentWidth,
        previousHeight: currentHeight,
        childCount: children.length,
        ...(hasError && { errors }),
      },
    };
  }

  private async checkBounds(params: Record<string, unknown>): Promise<SemanticResult> {
    const nodeId = params.nodeId as string;
    const autoFix = (params.autoFix as boolean) ?? false;

    // Get container properties
    const containerProps = await this.primitives.getNodeProperties({
      nodeId,
      properties: ['width', 'height', 'clipsContent'],
    }) as Record<string, unknown>;
    // getNodeProperties returns { id, type, width, height, clipsContent, ... } directly
    if (!containerProps) {
      return { success: false, error: `无法读取容器属性: ${nodeId}` };
    }

    const containerWidth = (containerProps.width as number) ?? 0;
    const containerHeight = (containerProps.height as number) ?? 0;
    const clipsContent = (containerProps.clipsContent as boolean) ?? false;

    // Get children
    const tree = await this.primitives.getNodeTree({ nodeId, depth: 1 }) as Record<string, unknown>;
    const children = tree?.children as Array<Record<string, unknown>> | undefined;

    if (!children || children.length === 0) {
      return { success: true, data: { fits: true, childCount: 0, message: '无子元素' } };
    }

    // Check each child against container bounds
    const violations: Array<{ childId: string; name: string; overflow: { left: number; top: number; right: number; bottom: number } }> = [];
    let maxOverflowWidth = containerWidth;
    let maxOverflowHeight = containerHeight;

    for (const child of children) {
      try {
        const childProps = await this.primitives.getNodeProperties({
          nodeId: child.id as string,
          properties: ['x', 'y', 'width', 'height', 'name'],
        }) as Record<string, unknown>;
        // getNodeProperties returns { id, type, x, y, width, height, name, ... } directly
        if (!childProps) continue;

        const x = (childProps.x as number) ?? 0;
        const y = (childProps.y as number) ?? 0;
        const w = (childProps.width as number) ?? 0;
        const h = (childProps.height as number) ?? 0;
        const name = (childProps.name as string) ?? child.id;

        const overflowLeft = -x;
        const overflowTop = -y;
        const overflowRight = (x + w) - containerWidth;
        const overflowBottom = (y + h) - containerHeight;

        if (overflowLeft > 0 || overflowTop > 0 || overflowRight > 0 || overflowBottom > 0) {
          violations.push({
            childId: child.id as string,
            name,
            overflow: {
              left: Math.max(0, overflowLeft),
              top: Math.max(0, overflowTop),
              right: Math.max(0, overflowRight),
              bottom: Math.max(0, overflowBottom),
            },
          });

          // Calculate needed container size
          maxOverflowWidth = Math.max(maxOverflowWidth, x + w);
          maxOverflowHeight = Math.max(maxOverflowHeight, y + h);
        }
      } catch {
        // Skip unreadable children
      }
    }

    const fits = violations.length === 0;
    const result: Record<string, unknown> = {
      fits,
      containerWidth,
      containerHeight,
      clipsContent,
      childCount: children.length,
      violationCount: violations.length,
    };

    if (!fits) {
      result.violations = violations;
      result.requiredWidth = Math.ceil(maxOverflowWidth);
      result.requiredHeight = Math.ceil(maxOverflowHeight);

      if (clipsContent) {
        result.warning = `${violations.length} 个子元素超出容器边界且 clipsContent=true，内容已被裁切！`;
      } else {
        result.warning = `${violations.length} 个子元素超出容器边界（clipsContent=false，内容可见但可能与其他元素重叠）`;
      }

      if (autoFix) {
        await this.primitives.resizeNode({
          nodeId,
          width: Math.ceil(maxOverflowWidth),
          height: Math.ceil(maxOverflowHeight),
        });
        result.fixed = true;
        result.newWidth = Math.ceil(maxOverflowWidth);
        result.newHeight = Math.ceil(maxOverflowHeight);
      }
    }

    return { success: true, data: result };
  }
}
