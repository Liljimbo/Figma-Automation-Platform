// ============================================================
// @figma-forge/plugin — 增强创建命令
// ============================================================

import { loadFont } from '../utils/font.js';

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

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
      const mainComponentId = p.mainComponentId as string | undefined;
      let mainComponent: ComponentNode | null = null;

      if (mainComponentId) {
        const found = figma.getNodeById(mainComponentId);
        if (found && found.type === 'COMPONENT') {
          mainComponent = found as ComponentNode;
        }
      }

      if (!mainComponent) {
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

  applyBaseProps(node, p);

  if (p.fills && Array.isArray(p.fills)) {
    node.fills = p.fills as Paint[];
  }

  if (p.strokes && Array.isArray(p.strokes)) {
    node.strokes = p.strokes as Paint[];
  }
  if (p.strokeWeight !== undefined && 'strokeWeight' in node) {
    (node as RectangleNode).strokeWeight = p.strokeWeight as number;
  }
  if (p.strokeAlign !== undefined && 'strokeAlign' in node) {
    (node as RectangleNode).strokeAlign = p.strokeAlign as 'CENTER' | 'INSIDE' | 'OUTSIDE';
  }

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

  if (p.effects && Array.isArray(p.effects)) {
    node.effects = p.effects as Effect[];
  }

  if (p.blendMode !== undefined && 'blendMode' in node) {
    node.blendMode = p.blendMode as BlendMode;
  }

  if (p.clipsContent !== undefined && 'clipsContent' in node) {
    (node as FrameNode).clipsContent = p.clipsContent as boolean;
  }

  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    if (p.layoutMode !== undefined) frame.layoutMode = p.layoutMode as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    if (p.paddingLeft !== undefined) frame.paddingLeft = p.paddingLeft as number;
    if (p.paddingRight !== undefined) frame.paddingRight = p.paddingRight as number;
    if (p.paddingTop !== undefined) frame.paddingTop = p.paddingTop as number;
    if (p.paddingBottom !== undefined) frame.paddingBottom = p.paddingBottom as number;
    if (p.itemSpacing !== undefined) frame.itemSpacing = p.itemSpacing as number;
  }

  appendToParent(node, p.parentId as string | undefined);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
  };
};

export const createTextNode: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;

  const textNode = figma.createText();
  textNode.name = (p.name as string) || 'Text';

  const fontFamily = (p.fontFamily as string) || 'Inter';
  const fontWeight = (p.fontWeight as string) || 'Regular';
  const fontName = await loadFont(fontFamily, fontWeight);

  textNode.fontName = fontName;
  textNode.characters = (p.content as string) || '';

  if (p.fontSize !== undefined) {
    textNode.fontSize = p.fontSize as number;
  }

  if (p.color) {
    const c = p.color as { r: number; g: number; b: number; a?: number };
    textNode.fills = [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a ?? 1 }];
  }

  if (p.textAlignHorizontal !== undefined) {
    textNode.textAlignHorizontal = p.textAlignHorizontal as 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  }

  if (p.width !== undefined || p.height !== undefined) {
    if ('resizeWithoutConstraints' in textNode) {
      textNode.resizeWithoutConstraints(
        (p.width as number) || textNode.width,
        (p.height as number) || textNode.height,
      );
    }
  }

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

export const createComponent: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;
  const component = figma.createComponent();
  component.name = (p.name as string) || 'Component';
  applyBaseProps(component, p);
  if (p.fills && Array.isArray(p.fills)) component.fills = p.fills as Paint[];
  if ('layoutMode' in component && p.layoutMode) {
    component.layoutMode = p.layoutMode as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  }
  appendToParent(component, p.parentId as string | undefined);
  return { id: component.id, name: component.name, type: component.type };
};

export const createInstance: CommandHandler = async (params) => {
  const p = params as Record<string, unknown>;
  const mainComponentId = p.mainComponentId as string;
  if (!mainComponentId) throw new Error('mainComponentId is required');
  const mainNode = figma.getNodeById(mainComponentId);
  if (!mainNode || mainNode.type !== 'COMPONENT') {
    throw new Error(`Component not found: ${mainComponentId}`);
  }
  const instance = (mainNode as ComponentNode).createInstance();
  instance.name = (p.name as string) || 'Instance';
  applyBaseProps(instance, p);
  appendToParent(instance, p.parentId as string | undefined);
  return { id: instance.id, name: instance.name, type: instance.type };
};

export const createHandlers: Record<string, CommandHandler> = {
  createNode,
  createTextNode,
};
