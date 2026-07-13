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

  // 偏移位置
  if (offset && 'x' in cloned && 'y' in cloned) {
    cloned.x += offset.x;
    cloned.y += offset.y;
  }

  // 移动到新父节点
  if (newParentId) {
    const parent = figma.getNodeById(newParentId);
    if (parent && 'children' in parent) {
      (parent as ChildrenMixin).appendChild(cloned);
    } else {
      // 如果目标父节点不存在，保持在原位置
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

// ─── setMultipleProperties — 批量设置属性 ───────────────────

export const setMultipleProperties: CommandHandler = async (params) => {
  const { updates } = params as {
    updates: Array<{
      nodeId: string;
      properties: Record<string, unknown>;
    }>;
  };

  if (!Array.isArray(updates)) {
    throw new Error('updates must be an array');
  }

  const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];

  for (const update of updates) {
    const node = figma.getNodeById(update.nodeId);
    if (!node) {
      results.push({
        nodeId: update.nodeId,
        success: false,
        error: `Node not found: ${update.nodeId}`,
      });
      continue;
    }

    const sceneNode = node as SceneNode;
    for (const [key, value] of Object.entries(update.properties)) {
      try {
        (sceneNode as unknown as Record<string, unknown>)[key] = value;
      } catch {
        // 忽略只读属性
      }
    }

    results.push({ nodeId: update.nodeId, success: true });
  }

  return {
    total: updates.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    details: results,
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

  // 收集所有节点
  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = figma.getNodeById(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }
    nodes.push(node as SceneNode);
  }

  // 创建 Frame 作为分组容器
  const groupFrame = figma.createFrame();
  groupFrame.name = name || 'Group';
  groupFrame.layoutMode = 'NONE';

  // 计算所有节点的边界框
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

  // 设置分组容器的尺寸和位置
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

  // 将节点移动到分组容器中
  for (const node of nodes) {
    // 转换绝对坐标到分组内的相对坐标
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

  // 将分组容器添加到目标父节点
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

    // 只处理 FRAME 类型（Group 在 Figma 中实际上是 Frame）
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

    // 获取 frame 在父节点中的位置
    const frameIndex = (parent as ChildrenMixin).children.indexOf(frame);

    // 将子节点逐个移出（使用递增索引避免偏移错误）
    const children = [...frame.children];
    let insertIdx = frameIndex;
    for (const child of children) {
      // 转换坐标
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

    // 移除空的 frame
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

// ─── 导出所有修改 handler ───────────────────────────────────

export const modifyHandlers: Record<string, CommandHandler> = {
  duplicateNode,
  groupNodes,
  ungroupNodes,
  swapComponent,
};
