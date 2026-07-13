// ============================================================
// @figma-bridge/plugin — Variables 命令处理器
// 设计 Token（Variables）的 CRUD 操作
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** 创建变量集合 */
const createVariableCollection: CommandHandler = async (params) => {
  const { name, modes } = params as { name: string; modes: string[] };

  if (!name) throw new Error('name is required');
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error('modes must be a non-empty array');
  }

  const collection = figma.variables.createVariableCollection(name);

  // 第一个 mode 在创建集合时自动产生，重命名为传入的值
  const defaultMode = collection.modes[0];
  collection.renameMode(defaultMode.modeId, modes[0]);

  // 添加额外的 modes（免费版可能限制为 1 个 mode）
  const addedModes = [];
  for (let i = 1; i < modes.length; i++) {
    try {
      collection.addMode(modes[i]);
      addedModes.push(modes[i]);
    } catch (err) {
      // Figma 免费版限制为 1 个 mode，忽略错误
    }
  }

  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    defaultModeId: collection.defaultModeId,
  };
};

/** 获取所有变量集合 */
const getVariableCollections: CommandHandler = async () => {
  const collections = figma.variables.getLocalVariableCollections();
  return collections.map(c => ({
    id: c.id,
    name: c.name,
    modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    defaultModeId: c.defaultModeId,
    variableIds: c.variableIds,
  }));
};

/** 创建变量 */
const createVariable: CommandHandler = async (params) => {
  const { name, collectionId, resolvedType, valuesByMode } = params as {
    name: string;
    collectionId: string;
    resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
    valuesByMode: Record<string, unknown>;
  };

  if (!name) throw new Error('name is required');
  if (!collectionId) throw new Error('collectionId is required');
  if (!resolvedType) throw new Error('resolvedType is required');

  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);

  const variable = figma.variables.createVariable(name, collection, resolvedType);

  // 设置每个 mode 的值
  if (valuesByMode) {
    for (const [modeId, value] of Object.entries(valuesByMode)) {
      try {
        variable.setValueForMode(modeId, value as VariableValue);
      } catch (err) {
        // mode 可能不存在，跳过
      }
    }
  }

  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    valuesByMode: variable.valuesByMode,
    collectionId,
  };
};

/** 获取变量列表 */
const getVariables: CommandHandler = async (params) => {
  const { type, collectionId } = params as {
    type?: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
    collectionId?: string;
  };

  let variables = figma.variables.getLocalVariables(type || undefined);

  // 按 collectionId 过滤
  if (collectionId) {
    const collection = figma.variables.getVariableCollectionById(collectionId);
    if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);
    const idSet = new Set(collection.variableIds);
    variables = variables.filter(v => idSet.has(v.id));
  }

  return variables.map(v => ({
    id: v.id,
    name: v.name,
    resolvedType: v.resolvedType,
    valuesByMode: v.valuesByMode,
  }));
};

/** 更新变量值 */
const updateVariableValue: CommandHandler = async (params) => {
  const { variableId, modeId, value } = params as {
    variableId: string;
    modeId: string;
    value: unknown;
  };

  if (!variableId) throw new Error('variableId is required');
  if (!modeId) throw new Error('modeId is required');

  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);

  variable.setValueForMode(modeId, value as VariableValue);

  return {
    id: variable.id,
    name: variable.name,
    valuesByMode: variable.valuesByMode,
  };
};

/** 删除变量 */
const deleteVariable: CommandHandler = async (params) => {
  const { variableId } = params as { variableId: string };
  if (!variableId) throw new Error('variableId is required');

  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);

  variable.remove();
  return { deleted: true, variableId };
};

/** 添加变量模式 */
const addVariableMode: CommandHandler = async (params) => {
  const { collectionId, modeName } = params as {
    collectionId: string;
    modeName: string;
  };

  if (!collectionId) throw new Error('collectionId is required');
  if (!modeName) throw new Error('modeName is required');

  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);

  const modeId = collection.addMode(modeName);
  return {
    collectionId,
    modeId,
    modeName,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
  };
};

/** 将变量绑定到节点属性 */
const assignVariableToNode: CommandHandler = async (params) => {
  const { variableId, nodeId, property } = params as {
    variableId: string;
    nodeId: string;
    property: string;
  };

  if (!variableId) throw new Error('variableId is required');
  if (!nodeId) throw new Error('nodeId is required');
  if (!property) throw new Error('property is required');

  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);

  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const sceneNode = node as SceneNode;

  if (!('setBoundVariable' in sceneNode)) {
    throw new Error(`Node does not support variable binding: ${nodeId}`);
  }

  (sceneNode as any).setBoundVariable(property, variable);

  return {
    assigned: true,
    variableId,
    nodeId,
    property,
  };
};

export const variablesHandlers: Record<string, CommandHandler> = {
  createVariableCollection,
  getVariableCollections,
  createVariable,
  getVariables,
  updateVariableValue,
  deleteVariable,
  addVariableMode,
  assignVariableToNode,
};
