// ============================================================
// @figma-forge/plugin — Figma Plugin 主线程
// 运行在 Figma 的沙箱环境中，直接访问 figma.* API
// ============================================================

import { serializeNode } from './utils/serialize.js';
import { readHandlers } from './commands/read.js';
import { createHandlers } from './commands/create.js';
import { modifyHandlers } from './commands/modify.js';
import { variablesHandlers } from './commands/variables.js';
import { variantsHandlers } from './commands/variants.js';
import { eventsHandlers } from './commands/events.js';
import { diffHandlers } from './commands/diff.js';

// ─── Command Handlers ──────────────────────────────────────

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, CommandHandler> = {};

function registerHandler(cmd: string, handler: CommandHandler) {
  handlers[cmd] = handler;
}

// ─── Read Handlers (from commands/read.ts) ──────────────────

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

// 从 commands/read.ts 导入的增强 handler
registerHandler('getNodeProperties', readHandlers.getNodeProperties);
registerHandler('findNodes', readHandlers.findNodes);
registerHandler('getStyles', readHandlers.getStyles);

// ─── Create Handlers (from commands/create.ts) ──────────────

registerHandler('createNode', createHandlers.createNode);
registerHandler('createTextNode', createHandlers.createTextNode);
registerHandler('createComponent', createHandlers.createComponent);
registerHandler('createInstance', createHandlers.createInstance);

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
    try {
      (sceneNode as unknown as Record<string, unknown>)[key] = value;
    } catch {
      // 忽略只读属性或不支持的属性
    }
  }

  return { updated: true, nodeId };
});

registerHandler('setLayout', async (params) => {
  const {
    nodeId, direction, paddingLeft, paddingRight,
    paddingTop, paddingBottom, itemSpacing,
    counterAxisAlignItems, primaryAxisAlignItems, layoutWrap,
  } = params as Record<string, unknown>;

  const node = figma.getNodeById(nodeId as string);
  if (!node || !('layoutMode' in node)) {
    throw new Error(`Node not found or not a frame: ${nodeId}`);
  }

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

// 从 commands/modify.ts 导入的增强 handler
registerHandler('duplicateNode', modifyHandlers.duplicateNode);
registerHandler('setMultipleProperties', modifyHandlers.setMultipleProperties);
registerHandler('groupNodes', modifyHandlers.groupNodes);
registerHandler('ungroupNodes', modifyHandlers.ungroupNodes);
registerHandler('swapComponent', modifyHandlers.swapComponent);

// ─── Variables Handlers (from commands/variables.ts) ───────
registerHandler('createVariableCollection', variablesHandlers.createVariableCollection);
registerHandler('getVariableCollections', variablesHandlers.getVariableCollections);
registerHandler('createVariable', variablesHandlers.createVariable);
registerHandler('getVariables', variablesHandlers.getVariables);
registerHandler('updateVariableValue', variablesHandlers.updateVariableValue);
registerHandler('deleteVariable', variablesHandlers.deleteVariable);
registerHandler('addVariableMode', variablesHandlers.addVariableMode);
registerHandler('assignVariableToNode', variablesHandlers.assignVariableToNode);

// ─── Variants Handlers (from commands/variants.ts) ────────
registerHandler('createComponentSet', variantsHandlers.createComponentSet);
registerHandler('getComponentSets', variantsHandlers.getComponentSets);
registerHandler('createVariantInstance', variantsHandlers.createVariantInstance);
registerHandler('setVariantProperties', variantsHandlers.setVariantProperties);

// ─── Event Listeners (from commands/events.ts) ───────────
registerHandler('startListening', eventsHandlers.startListening);
registerHandler('stopListening', eventsHandlers.stopListening);

// ─── Diff Engine (from commands/diff.ts) ─────────────────
registerHandler('snapshotNode', diffHandlers.snapshotNode);

// ─── Message Handler ───────────────────────────────────────

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

// ─── Plugin 生命周期 ──────────────────────────────────────

figma.showUI(__html__, {
  width: 400,
  height: 200,
  title: 'Figma Forge',
});

figma.ui.postMessage({ type: 'init', payload: { status: 'ready' } });
