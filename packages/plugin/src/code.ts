// ============================================================
// @figma-forge/plugin — Figma Plugin 主线程
// ============================================================

import { readHandlers } from './commands/read.js';
import { createHandlers, appendToParent } from './commands/create.js';
import { modifyHandlers } from './commands/modify.js';
import { variablesHandlers } from './commands/variables.js';
import { variantsHandlers } from './commands/variants.js';
import { eventsHandlers } from './commands/events.js';
import { diffHandlers } from './commands/diff.js';

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, CommandHandler> = {};

function registerHandler(cmd: string, handler: CommandHandler) {
  handlers[cmd] = handler;
}

registerHandler('getDocumentInfo', async () => {
  const pages = figma.root.children.map(page => ({
    id: page.id,
    name: page.name,
  }));
  return {
    name: figma.root.name,
    id: figma.root.id,
    pages,
  };
});

registerHandler('getNodeTree', async (params) => {
  const { nodeId, depth = 3 } = params as { nodeId?: string; depth?: number };

  let startNode: PageNode | FrameNode;
  if (nodeId) {
    const node = figma.getNodeById(nodeId);
    if (!node || !('children' in node)) {
      throw new Error(`Node not found or not a container: ${nodeId}`);
    }
    startNode = node as PageNode | FrameNode;
  } else {
    startNode = figma.currentPage;
  }

  function buildTree(node: PageNode | FrameNode | SceneNode, currentDepth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: 'visible' in node ? node.visible : true,
    };

    if ('children' in node && currentDepth < depth) {
      result.children = (node as PageNode | FrameNode).children.map(child =>
        buildTree(child, currentDepth + 1)
      );
    }

    return result;
  }

  return buildTree(startNode, 0);
});

registerHandler('getNodeProperties', readHandlers.getNodeProperties);
registerHandler('findNodes', readHandlers.findNodes);
registerHandler('getStyles', readHandlers.getStyles);

registerHandler('createNode', createHandlers.createNode);
registerHandler('createTextNode', createHandlers.createTextNode);

// ─── Modify Handlers (from commands/modify.ts + inline) ─────

registerHandler('deleteNode', async (params) => {
  const { nodeId } = params as { nodeId: string };
  const node = figma.getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  node.remove();
  return { deleted: true, nodeId };
});

registerHandler('setProperties', async (params) => {
  const { nodeId, properties } = params as {
    nodeId: string;
    properties: Record<string, unknown>;
  };

  const node = figma.getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const sceneNode = node as SceneNode;

  for (const [key, value] of Object.entries(properties)) {
    (sceneNode as unknown as Record<string, unknown>)[key] = value;
  }

  return { updated: true, nodeId };
});

registerHandler('setLayout', async (params) => {
  const {
    nodeId, direction, paddingLeft, paddingRight,
    paddingTop, paddingBottom, itemSpacing,
    counterAxisAlignItems, primaryAxisAlignItems, layoutWrap,
    counterAxisSpacing,
  } = params as Record<string, unknown>;

  const node = figma.getNodeById(nodeId as string);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const hasFrameProps = direction !== undefined || paddingLeft !== undefined || paddingRight !== undefined
    || paddingTop !== undefined || paddingBottom !== undefined || itemSpacing !== undefined
    || counterAxisAlignItems !== undefined || primaryAxisAlignItems !== undefined || layoutWrap !== undefined
    || counterAxisSpacing !== undefined;
  const hasLayoutSizing = params.layoutSizingHorizontal !== undefined || params.layoutSizingVertical !== undefined
    || params.layoutGrow !== undefined || params.layoutAlign !== undefined;

  // 如果需要设置 Frame 专属属性（方向、padding 等），节点必须是 Frame
  if (hasFrameProps && !('layoutMode' in node)) {
    throw new Error(`Node ${nodeId} is not a frame — cannot set layout direction/padding on non-frame nodes`);
  }

  // 设置 Frame 专属 Auto Layout 属性
  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    if (direction !== undefined) frame.layoutMode = direction as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    if (paddingLeft !== undefined) frame.paddingLeft = paddingLeft as number;
    if (paddingRight !== undefined) frame.paddingRight = paddingRight as number;
    if (paddingTop !== undefined) frame.paddingTop = paddingTop as number;
    if (paddingBottom !== undefined) frame.paddingBottom = paddingBottom as number;
    if (itemSpacing !== undefined) frame.itemSpacing = itemSpacing as number;
    if (counterAxisAlignItems !== undefined) {
      frame.counterAxisAlignItems = counterAxisAlignItems as 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
    }
    if (primaryAxisAlignItems !== undefined) {
      frame.primaryAxisAlignItems = primaryAxisAlignItems as 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
    }
    if (layoutWrap !== undefined) {
      frame.layoutWrap = layoutWrap as 'NO_WRAP' | 'WRAP';
    }
    if (counterAxisSpacing !== undefined) {
      frame.counterAxisSpacing = counterAxisSpacing as number;
    }
  }

  // Layout Sizing — Frame 和 Text 节点均可设置（Text 需在 Auto Layout 容器内）
  if (params.layoutSizingHorizontal !== undefined && 'layoutSizingHorizontal' in node) {
    (node as FrameNode).layoutSizingHorizontal = params.layoutSizingHorizontal as 'FIXED' | 'HUG' | 'FILL';
  }
  if (params.layoutSizingVertical !== undefined && 'layoutSizingVertical' in node) {
    (node as FrameNode).layoutSizingVertical = params.layoutSizingVertical as 'FIXED' | 'HUG' | 'FILL';
  }
  if (params.layoutGrow !== undefined && 'layoutGrow' in node) {
    (node as FrameNode).layoutGrow = params.layoutGrow as number;
  }
  if (params.layoutAlign !== undefined && 'layoutAlign' in node) {
    (node as FrameNode).layoutAlign = params.layoutAlign as 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  }

  if (!hasFrameProps && !hasLayoutSizing) {
    throw new Error(`No valid layout properties provided for ${nodeId}`);
  }

  return { updated: true, nodeId };
});

registerHandler('moveNode', async (params) => {
  const { nodeId, newParentId, index } = params as {
    nodeId: string;
    newParentId: string;
    index?: number;
  };

  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const newParent = figma.getNodeById(newParentId);
  if (!newParent || !('children' in newParent)) {
    throw new Error(`Parent not found: ${newParentId}`);
  }

  if (index !== undefined) {
    (newParent as ChildrenMixin).insertChild(index, node as SceneNode);
  } else {
    (newParent as ChildrenMixin).appendChild(node as SceneNode);
  }

  return { moved: true, nodeId, newParentId };
});

registerHandler('resizeNode', async (params) => {
  const { nodeId, width, height } = params as {
    nodeId: string;
    width: number;
    height: number;
  };

  const node = figma.getNodeById(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (!('resizeWithoutConstraints' in node)) {
    throw new Error(`Node ${nodeId} does not support resize (type: ${node.type})`);
  }

  (node as unknown as { resizeWithoutConstraints: (w: number, h: number) => void })
    .resizeWithoutConstraints(width, height);

  return {
    resized: true,
    nodeId,
    width: (node as unknown as { width: number }).width,
    height: (node as unknown as { height: number }).height,
  };
});

registerHandler('createFromSvg', async (params) => {
  const { svg, name, parentId, x, y } = params as {
    svg: string;
    name?: string;
    parentId?: string;
    x?: number;
    y?: number;
  };

  if (!svg || typeof svg !== 'string') {
    throw new Error('svg parameter is required and must be a string');
  }

  // Validate SVG basic structure
  if (!svg.trim().startsWith('<svg') && !svg.trim().startsWith('<?xml')) {
    throw new Error('Invalid SVG: must start with <svg or <?xml');
  }

  const node = figma.createNodeFromSvg(svg);
  node.name = name || 'SVG Import';

  // 设置指定的位置
  if (x !== undefined) (node as unknown as { x: number }).x = x;
  if (y !== undefined) (node as unknown as { y: number }).y = y;

  // 使用 appendToParent 自动处理定位和防重叠偏移
  appendToParent(node, parentId);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    width: (node as SceneNode).width,
    height: (node as SceneNode).height,
  };
});

registerHandler('exportNode', async (params) => {
  const { nodeId, format = 'PNG', scale = 1 } = params as {
    nodeId: string;
    format?: string;
    scale?: number;
  };

  const node = figma.getNodeById(nodeId);
  if (!node || !('exportAsync' in node)) {
    throw new Error(`Node not found or not exportable: ${nodeId}`);
  }

  const bytes = await (node as SceneNode).exportAsync({
    format: format as 'PNG' | 'JPG' | 'SVG' | 'PDF',
    constraint: { type: 'SCALE', value: scale },
  });

  const base64 = figma.base64Encode(bytes);
  return { base64, format, width: (node as SceneNode).width, height: (node as SceneNode).height };
});

registerHandler('duplicateNode', modifyHandlers.duplicateNode);
registerHandler('groupNodes', modifyHandlers.groupNodes);
registerHandler('ungroupNodes', modifyHandlers.ungroupNodes);
registerHandler('swapComponent', modifyHandlers.swapComponent);

registerHandler('createVariableCollection', variablesHandlers.createVariableCollection);
registerHandler('getVariableCollections', variablesHandlers.getVariableCollections);
registerHandler('createVariable', variablesHandlers.createVariable);
registerHandler('getVariables', variablesHandlers.getVariables);
registerHandler('updateVariableValue', variablesHandlers.updateVariableValue);
registerHandler('deleteVariable', variablesHandlers.deleteVariable);
registerHandler('addVariableMode', variablesHandlers.addVariableMode);
registerHandler('assignVariableToNode', variablesHandlers.assignVariableToNode);

registerHandler('createComponentSet', variantsHandlers.createComponentSet);
registerHandler('getComponentSets', variantsHandlers.getComponentSets);
registerHandler('createVariantInstance', variantsHandlers.createVariantInstance);
registerHandler('setVariantProperties', variantsHandlers.setVariantProperties);

registerHandler('startListening', eventsHandlers.startListening);
registerHandler('stopListening', eventsHandlers.stopListening);

registerHandler('snapshotNode', diffHandlers.snapshotNode);

figma.ui.onmessage = async (msg: { id: string; cmd: string; params: Record<string, unknown> }) => {
  const { id, cmd, params } = msg;

  try {
    const handler = handlers[cmd];
    if (!handler) {
      throw new Error(`Unknown command: ${cmd}`);
    }

    const result = await handler(params || {});

    figma.ui.postMessage({
      type: 'result',
      payload: { id, success: true, data: result },
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'result',
      payload: {
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

figma.showUI(__html__, {
  width: 400,
  height: 200,
  title: 'Figma Forge',
});

figma.ui.postMessage({ type: 'init', payload: { status: 'ready' } });
