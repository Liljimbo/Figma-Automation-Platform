// ============================================================
// @figma-forge/plugin — 增强创建命令
// ============================================================

import { loadFont } from '../utils/font.js';

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ─── 辅助：将节点添加到父节点 ──────────────────────────────

function appendToParent(
  node: SceneNode,
  parentId?: string,
): void {
  if (parentId) {
    const parent = figma.getNodeById(parentId);
    if (parent && 'children' in parent) {
      (parent as ChildrenMixin).appendChild(node);
      return;
    }
  }
  figma.currentPage.appendChild(node);
}

// ─── 辅助：应用基础属性 ─────────────────────────────────────

function applyBaseProps(
  node: SceneNode,
  p: Record<string, unknown>,
): void {
  if (p.x !== undefined && 'x' in node) node.x = p.x as number;
  if (p.y !== undefined && 'y' in node) node.y = p.y as number;
  if ('resizeWithoutConstraints' in node) {
    if (p.width !== undefined && p.height !== undefined) {
      (node as unknown as { resizeWithoutConstraints: (w: number, h: number) => void })
        .resizeWithoutConstraints(p.width as number, p.height as number);
    } else if (p.width !== undefined) {
      (node as unknown as { resizeWithoutConstraints: (w: number, h: number) => void })
        .resizeWithoutConstraints(p.width as number, node.height);
    } else if (p.height !== undefined) {
      (node as unknown as { resizeWithoutConstraints: (w: number, h: number) => void })
        .resizeWithoutConstraints(node.width, p.height as number);
    }
  }
  if (p.opacity !== undefined && 'opacity' in node) node.opacity = p.opacity as number;
  if (p.visible !== undefined) node.visible = p.visible as boolean;
  if (p.rotation !== undefined && 'rotation' in node) node.rotation = p.rotation as number;
}

// ─── createNode — 增强版 ────────────────────────────────────

export const createNode: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;

  let node: SceneNode;

  switch (p.type) {
    case 'FRAME': {
      const frame = figma.createFrame();
      frame.name = (p.name as string) || 'Frame';
      node = frame;
      break;
    }
    case 'GROUP': {
      // Group 需要先有子节点，创建空 frame 模拟
      const frame = figma.createFrame();
      frame.name = (p.name as string) || 'Group';
      node = frame;
      break;
    }
    case 'COMPONENT': {
      const component = figma.createComponent();
      component.name = (p.name as string) || 'Component';
      node = component;
      break;
    }
    case 'INSTANCE': {
      // Instance 需要一个主组件
      const mainComponentId = p.mainComponentId as string | undefined;
      let mainComponent: ComponentNode | null = null;

      if (mainComponentId) {
        const found = figma.getNodeById(mainComponentId);
        if (found && found.type === 'COMPONENT') {
          mainComponent = found as ComponentNode;
        }
      }

      if (!mainComponent) {
        // 如果没有提供主组件，创建一个临时组件
        const tempComponent = figma.createComponent();
        tempComponent.name = (p.name as string) || 'TempComponent';
        const rect = figma.createRectangle();
        rect.resizeWithoutConstraints(100, 100);
        tempComponent.appendChild(rect);
        mainComponent = tempComponent;
      }

      const instance = mainComponent.createInstance();
      instance.name = (p.name as string) || 'Instance';
      node = instance;
      break;
    }
    case 'RECTANGLE': {
      const rect = figma.createRectangle();
      rect.name = (p.name as string) || 'Rectangle';
      node = rect;
      break;
    }
    case 'ELLIPSE': {
      const ellipse = figma.createEllipse();
      ellipse.name = (p.name as string) || 'Ellipse';
      node = ellipse;
      break;
    }
    case 'LINE': {
      const line = figma.createLine();
      line.name = (p.name as string) || 'Line';
      node = line;
      break;
    }
    case 'VECTOR': {
      const vector = figma.createVector();
      vector.name = (p.name as string) || 'Vector';
      node = vector;
      break;
    }
    case 'STAR': {
      const star = figma.createStar();
      star.name = (p.name as string) || 'Star';
      node = star;
      break;
    }
    case 'POLYGON': {
      const polygon = figma.createPolygon();
      polygon.name = (p.name as string) || 'Polygon';
      node = polygon;
      break;
    }
    default:
      throw new Error(`Unknown node type: ${p.type}`);
  }

  // 应用基础属性
  applyBaseProps(node, p);

  // 设置填充
  if (p.fills && Array.isArray(p.fills)) {
    node.fills = p.fills as Paint[];
  }

  // 设置描边
  if (p.strokes && Array.isArray(p.strokes)) {
    node.strokes = p.strokes as Paint[];
  }
  if (p.strokeWeight !== undefined && 'strokeWeight' in node) {
    (node as RectangleNode).strokeWeight = p.strokeWeight as number;
  }
  if (p.strokeAlign !== undefined && 'strokeAlign' in node) {
    (node as RectangleNode).strokeAlign = p.strokeAlign as 'CENTER' | 'INSIDE' | 'OUTSIDE';
  }

  // 设置圆角
  if (p.cornerRadius !== undefined && 'cornerRadius' in node) {
    (node as RectangleNode).cornerRadius = p.cornerRadius as number;
  }
  if (p.topLeftRadius !== undefined && 'topLeftRadius' in node) {
    const rect = node as RectangleNode;
    rect.topLeftRadius = p.topLeftRadius as number;
    rect.topRightRadius = (p.topRightRadius as number) ?? rect.topRightRadius;
    rect.bottomLeftRadius = (p.bottomLeftRadius as number) ?? rect.bottomLeftRadius;
    rect.bottomRightRadius = (p.bottomRightRadius as number) ?? rect.bottomRightRadius;
  }

  // 设置效果
  if (p.effects && Array.isArray(p.effects)) {
    node.effects = p.effects as Effect[];
  }

  // 设置混合模式
  if (p.blendMode !== undefined && 'blendMode' in node) {
    node.blendMode = p.blendMode as BlendMode;
  }

  // 设置裁切
  if (p.clipsContent !== undefined && 'clipsContent' in node) {
    (node as FrameNode).clipsContent = p.clipsContent as boolean;
  }

  // Auto Layout
  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    if (p.layoutMode !== undefined) frame.layoutMode = p.layoutMode as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    if (p.paddingLeft !== undefined) frame.paddingLeft = p.paddingLeft as number;
    if (p.paddingRight !== undefined) frame.paddingRight = p.paddingRight as number;
    if (p.paddingTop !== undefined) frame.paddingTop = p.paddingTop as number;
    if (p.paddingBottom !== undefined) frame.paddingBottom = p.paddingBottom as number;
    if (p.itemSpacing !== undefined) frame.itemSpacing = p.itemSpacing as number;
  }

  // 添加到父节点
  appendToParent(node, p.parentId as string | undefined);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
  };
};

// ─── createTextNode — 增强版 ─────────────────────────────────

export const createTextNode: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;

  const textNode = figma.createText();
  textNode.name = (p.name as string) || 'Text';

  // 加载字体
  const fontFamily = (p.fontFamily as string) || 'Inter';
  const fontWeight = (p.fontWeight as string) || 'Regular';
  const fontName = await loadFont(fontFamily, fontWeight);

  textNode.fontName = fontName;

  // 设置文本内容
  textNode.characters = (p.content as string) || '';

  // 设置字体大小
  if (p.fontSize !== undefined) {
    textNode.fontSize = p.fontSize as number;
  }

  // 设置字体颜色
  if (p.color) {
    const c = p.color as { r: number; g: number; b: number; a?: number };
    textNode.fills = [{
      type: 'SOLID',
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a ?? 1,
    }];
  }

  // 对齐
  if (p.textAlignHorizontal) {
    textNode.textAlignHorizontal = p.textAlignHorizontal as typeof textNode.textAlignHorizontal;
  }
  if (p.textAlignVertical) {
    textNode.textAlignVertical = p.textAlignVertical as typeof textNode.textAlignVertical;
  }

  // 行高
  if (p.lineHeight) {
    const lh = p.lineHeight as number | { value: number; unit: 'PIXELS' | 'PERCENT' };
    textNode.lineHeight = typeof lh === 'number'
      ? { value: lh, unit: 'PIXELS' }
      : lh;
  }

  // 字间距
  if (p.letterSpacing) {
    const ls = p.letterSpacing as number | { value: number; unit: 'PIXELS' | 'PERCENT' };
    textNode.letterSpacing = typeof ls === 'number'
      ? { value: ls, unit: 'PIXELS' }
      : ls;
  }

  // 文本大小写
  if (p.textCase) {
    textNode.textCase = p.textCase as typeof textNode.textCase;
  }

  // 文本装饰
  if (p.textDecoration) {
    textNode.textDecoration = p.textDecoration as typeof textNode.textDecoration;
  }

  // 自动调整大小
  if (p.textAutoResize) {
    textNode.textAutoResize = p.textAutoResize as typeof textNode.textAutoResize;
  }

  // 段落间距
  if (p.paragraphSpacing !== undefined) {
    textNode.paragraphSpacing = p.paragraphSpacing as number;
  }

  // 段落缩进
  if (p.paragraphIndent !== undefined) {
    textNode.paragraphIndent = p.paragraphIndent as number;
  }

  // 尺寸
  if (p.width !== undefined && p.height !== undefined) {
    textNode.resizeWithoutConstraints(p.width as number, p.height as number);
  } else if (p.width !== undefined) {
    textNode.resizeWithoutConstraints(p.width as number, textNode.height);
  }

  // 位置
  if (p.x !== undefined) textNode.x = p.x as number;
  if (p.y !== undefined) textNode.y = p.y as number;

  // 透明度
  if (p.opacity !== undefined) textNode.opacity = p.opacity as number;

  // 约束
  if (p.constraints !== undefined && 'constraints' in textNode) {
    textNode.constraints = p.constraints as Constraints;
  }

  // 添加到父节点
  appendToParent(textNode, p.parentId as string | undefined);

  return {
    id: textNode.id,
    name: textNode.name,
    type: textNode.type,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontName: textNode.fontName,
  };
};

// ─── createComponent ────────────────────────────────────────

export const createComponent: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;

  const component = figma.createComponent();
  component.name = (p.name as string) || 'Component';

  // 应用基础属性
  applyBaseProps(component, p);

  // 设置填充
  if (p.fills && Array.isArray(p.fills)) {
    component.fills = p.fills as Paint[];
  }

  // 设置 Auto Layout
  if (p.layoutMode !== undefined) {
    component.layoutMode = p.layoutMode as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  }
  if (p.paddingLeft !== undefined) component.paddingLeft = p.paddingLeft as number;
  if (p.paddingRight !== undefined) component.paddingRight = p.paddingRight as number;
  if (p.paddingTop !== undefined) component.paddingTop = p.paddingTop as number;
  if (p.paddingBottom !== undefined) component.paddingBottom = p.paddingBottom as number;
  if (p.itemSpacing !== undefined) component.itemSpacing = p.itemSpacing as number;

  // 裁切
  if (p.clipsContent !== undefined) {
    component.clipsContent = p.clipsContent as boolean;
  }

  // 添加到父节点
  appendToParent(component, p.parentId as string | undefined);

  // 如果提供了子节点定义，递归创建
  const children = p.children as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(children)) {
    for (const childDef of children) {
      // 简化：只支持基础类型
      let childNode: SceneNode | null = null;
      switch (childDef.type) {
        case 'RECTANGLE': {
          childNode = figma.createRectangle();
          childNode.name = (childDef.name as string) || 'Rectangle';
          break;
        }
        case 'TEXT': {
          childNode = figma.createText();
          childNode.name = (childDef.name as string) || 'Text';
          if (childDef.content) {
            const fontName = await loadFont(
              (childDef.fontFamily as string) || 'Inter',
              (childDef.fontWeight as string) || 'Regular'
            );
            childNode.fontName = fontName;
            (childNode as TextNode).characters = childDef.content as string;
          }
          break;
        }
        default:
          continue;
      }
      if (childNode) {
        applyBaseProps(childNode, childDef);
        component.appendChild(childNode);
      }
    }
  }

  return {
    id: component.id,
    name: component.name,
    type: component.type,
    children: component.children.length,
  };
};

// ─── createInstance ─────────────────────────────────────────

export const createInstance: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;

  const mainComponentId = p.mainComponentId as string;
  if (!mainComponentId) {
    throw new Error('mainComponentId is required');
  }

  const found = figma.getNodeById(mainComponentId);
  if (!found || found.type !== 'COMPONENT') {
    throw new Error(`Component not found: ${mainComponentId}`);
  }

  const mainComponent = found as ComponentNode;
  const instance = mainComponent.createInstance();
  instance.name = (p.name as string) || mainComponent.name;

  // 应用基础属性
  applyBaseProps(instance, p);

  // 覆盖实例属性
  if (p.fills && Array.isArray(p.fills)) {
    instance.fills = p.fills as Paint[];
  }
  if (p.opacity !== undefined) instance.opacity = p.opacity as number;
  if (p.visible !== undefined) instance.visible = p.visible as boolean;

  // 添加到父节点
  appendToParent(instance, p.parentId as string | undefined);

  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    mainComponentId: mainComponent.id,
  };
};

// ─── 导出所有创建 handler ───────────────────────────────────

export const createHandlers: Record<string, CommandHandler> = {
  createNode,
  createTextNode,
  createComponent,
  createInstance,
};
