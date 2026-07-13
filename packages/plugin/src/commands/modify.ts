// ============================================================
// @figma-forge/plugin — 增强修改命令
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ─── duplicateNode — 复制节点 ───────────────────────────────

export const duplicateNode: CommandHandler = async (params) => {
  const { nodeId, name, newName, newParentId, offset } = params as {
    nodeId: string;
    name?: string;
    newName?: string;
    newParentId?: string;
    offset?: { x: number; y: number };
  };

  const node = figma.getNodeById(nodeId);
  if (!node || !('clone' in node)) {
    throw new Error(`Node not found or not clonable: ${nodeId}`);
  }

  const cloned = (node as SceneNode).clone();
  cloned.name = newName || name || `${node.name} Copy`;

  if (offset && 'x' in cloned && 'y' in cloned) {
    cloned.x += offset.x;
    cloned.y += offset.y;
  }

  if (newParentId) {
    const parent = figma.getNodeById(newParentId);
    if (parent && 'children' in parent) {
      (parent as ChildrenMixin).appendChild(cloned);
    } else {
      figma.currentPage.appendChild(cloned);
    }
  }

  return {
    id: cloned.id,
    name: cloned.name,
    type: cloned.type,
    originalId: nodeId,
  };
};

// ─── groupNodes — 将多个节点分组 ───────────────────────────

export const groupNodes: CommandHandler = async (params) => {
  const { nodeIds, name, parentId } = params as {
    nodeIds: string[];
    name?: string;
    parentId?: string;
  };

  if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error('groupNodes requires at least 2 nodeIds');
  }

  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = figma.getNodeById(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }
    nodes.push(node as SceneNode);
  }

  const groupFrame = figma.createFrame();
  groupFrame.name = name || 'Group';
  groupFrame.layoutMode = 'NONE';

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const node of nodes) {
    const bounds = node.absoluteBoundingBox;
    if (bounds) {
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  if (minX !== Infinity) {
    const parent = parentId
      ? figma.getNodeById(parentId)
      : nodes[0].parent;

    if (parent && 'absoluteTransform' in parent) {
      const parentBounds = (parent as SceneNode).absoluteBoundingBox;
      if (parentBounds) {
        minX -= parentBounds.x;
        minY -= parentBounds.y;
      }
    }

    groupFrame.x = minX;
    groupFrame.y = minY;
    groupFrame.resizeWithoutConstraints(maxX - minX || 1, maxY - minY || 1);
  }

  for (const node of nodes) {
    const nodeBounds = node.absoluteBoundingBox;
    const groupBounds = groupFrame.absoluteBoundingBox;
    if (nodeBounds && groupBounds) {
      const relX = node.x - (groupBounds.x - (node.parent && 'absoluteBoundingBox' in node.parent
        ? ((node.parent as SceneNode).absoluteBoundingBox?.x ?? 0) : 0));
      const relY = node.y - (groupBounds.y - (node.parent && 'absoluteBoundingBox' in node.parent
        ? ((node.parent as SceneNode).absoluteBoundingBox?.y ?? 0) : 0));

      groupFrame.appendChild(node);
      node.x = relX;
      node.y = relY;
    } else {
      groupFrame.appendChild(node);
    }
  }

  const targetParentId = parentId || nodes[0].parent?.id;
  if (targetParentId) {
    const targetParent = figma.getNodeById(targetParentId);
    if (targetParent && 'children' in targetParent) {
      (targetParent as ChildrenMixin).appendChild(groupFrame);
    } else {
      figma.currentPage.appendChild(groupFrame);
    }
  } else {
    figma.currentPage.appendChild(groupFrame);
  }

  return {
    id: groupFrame.id,
    name: groupFrame.name,
    type: groupFrame.type,
    childCount: nodes.length,
  };
};

// ─── ungroupNodes — 取消分组 ───────────────────────────────

export const ungroupNodes: CommandHandler = async (params) => {
  const { nodeId, nodeIds } = params as { nodeId?: string; nodeIds?: string[] };

  const ids = nodeIds && nodeIds.length > 0 ? nodeIds : nodeId ? [nodeId] : [];
  if (ids.length === 0) {
    throw new Error('nodeId or nodeIds is required');
  }

  const results: Array<{ nodeId: string; ungrouped: boolean; error?: string }> = [];

  for (const id of ids) {
    const node = figma.getNodeById(id);
    if (!node) {
      results.push({ nodeId: id, ungrouped: false, error: `Node not found: ${id}` });
      continue;
    }

    if (node.type !== 'FRAME') {
      results.push({
        nodeId: id,
        ungrouped: false,
        error: `Node is not a frame/group: ${node.type}`,
      });
      continue;
    }

    const frame = node as FrameNode;
    const parent = frame.parent;

    if (!parent || !('children' in parent)) {
      results.push({
        nodeId: id,
        ungrouped: false,
        error: 'Cannot ungroup: no valid parent',
      });
      continue;
    }

    const frameIndex = (parent as ChildrenMixin).children.indexOf(frame);

    // 将子节点逐个移出（使用递增索引避免偏移错误）
    const children = [...frame.children];
    let insertIdx = frameIndex;
    for (const child of children) {
      const childBounds = child.absoluteBoundingBox;
      const frameBounds = frame.absoluteBoundingBox;
      if (childBounds && frameBounds && parent && 'absoluteBoundingBox' in parent) {
        const parentBounds = (parent as SceneNode).absoluteBoundingBox;
        if (parentBounds) {
          child.x = childBounds.x - parentBounds.x;
          child.y = childBounds.y - parentBounds.y;
        }
      }

      (parent as ChildrenMixin).insertChild(insertIdx, child);
      insertIdx++;
    }

    frame.remove();
    results.push({ nodeId: id, ungrouped: true });
  }

  return {
    total: ids.length,
    succeeded: results.filter(r => r.ungrouped).length,
    failed: results.filter(r => !r.ungrouped).length,
    details: results,
  };
};

// ─── swapComponent — 替换 Component ─────────────────────────

export const swapComponent: CommandHandler = async (params) => {
  const { instanceId: rawInstanceId, nodeId, newComponentId: rawNewId, componentName } = params as {
    instanceId?: string;
    nodeId?: string;
    newComponentId?: string;
    componentName?: string;
  };

  const instanceId = rawInstanceId || nodeId;
  if (!instanceId) {
    throw new Error('instanceId (or nodeId) is required');
  }

  const instanceNode = figma.getNodeById(instanceId);
  if (!instanceNode || instanceNode.type !== 'INSTANCE') {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  const instance = instanceNode as InstanceNode;

  let newComponent: ComponentNode;
  if (rawNewId) {
    const node = figma.getNodeById(rawNewId);
    if (!node || node.type !== 'COMPONENT') {
      throw new Error(`Component not found: ${rawNewId}`);
    }
    newComponent = node as ComponentNode;
  } else if (componentName) {
    const found = figma.root.findOne(n => n.type === 'COMPONENT' && n.name === componentName);
    if (!found) {
      throw new Error(`Component not found by name: ${componentName}`);
    }
    newComponent = found as ComponentNode;
  } else {
    throw new Error('newComponentId or componentName is required');
  }

  instance.swapComponent(newComponent);

  return {
    instanceId: instance.id,
    newComponentId: newComponent.id,
    componentName: newComponent.name,
    swapped: true,
  };
};

export const modifyHandlers: Record<string, CommandHandler> = {
  duplicateNode,
  groupNodes,
  ungroupNodes,
  swapComponent,
};
