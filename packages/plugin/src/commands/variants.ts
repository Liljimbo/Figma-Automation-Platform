// ============================================================
// @figma-bridge/plugin — Component Variants 命令处理器
// 变体系统的创建、查询、实例化
// ============================================================

type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** 辅助：将 properties 对象转为 Figma 组件名格式 "Key=Value, Key=Value" */
function propertiesToVariantName(properties: Record<string, string>): string {
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

/** 辅助：将 Figma 组件名解析为 properties 对象 */
function variantNameToProperties(name: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of name.split(',').map(s => s.trim())) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      props[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  }
  return props;
}

/** 创建组件变体集 */
const createComponentSet: CommandHandler = async (params) => {
  const { name, variants, parentId } = params as {
    name: string;
    variants: Array<{
      name: string;
      properties: Record<string, string>;
      width?: number;
      height?: number;
      fills?: Array<{ type: string; color?: { r: number; g: number; b: number } }>;
    }>;
    parentId?: string;
  };

  if (!name) throw new Error('name is required');
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('variants must be a non-empty array');
  }

  const parent = parentId
    ? figma.getNodeById(parentId)
    : figma.currentPage;

  if (!parent || !('children' in parent)) {
    throw new Error(`Parent node not found or not a container: ${parentId}`);
  }

  const components: ComponentNode[] = [];

  for (const variant of variants) {
    const comp = figma.createComponent();
    comp.name = propertiesToVariantName(variant.properties);

    if (variant.width) comp.resize(variant.width, variant.height || comp.height);
    if (variant.height && !variant.width) comp.resize(comp.width, variant.height);

    if (variant.fills) {
      comp.fills = variant.fills as Paint[];
    }

    components.push(comp);
  }

  const componentSet = figma.combineAsVariants(
    components,
    parent as BaseNode & ChildrenMixin
  );
  componentSet.name = name;

  return {
    id: componentSet.id,
    name: componentSet.name,
    type: 'COMPONENT_SET',
    variants: (componentSet.children as readonly ComponentNode[]).map((child: ComponentNode) => ({
      id: child.id,
      name: child.name,
      properties: child.variantProperties,
    })),
  };
};

/** 获取所有组件变体集 */
const getComponentSets: CommandHandler = async () => {
  const sets = figma.currentPage.findAll(node => node.type === 'COMPONENT_SET') as ComponentSetNode[];
  return sets.map((set: ComponentSetNode) => ({
    id: set.id,
    name: set.name,
    variants: (set.children as readonly ComponentNode[]).map((child: ComponentNode) => ({
      id: child.id,
      name: child.name,
      properties: child.variantProperties,
    })),
  }));
};

/** 创建变体实例（通过变体属性匹配具体组件） */
const createVariantInstance: CommandHandler = async (params) => {
  const { componentSetId, variantProperties, parentId } = params as {
    componentSetId: string;
    variantProperties: Record<string, string>;
    parentId?: string;
  };

  if (!componentSetId) throw new Error('componentSetId is required');
  if (!variantProperties) throw new Error('variantProperties is required');

  const node = figma.getNodeById(componentSetId);
  if (!node || node.type !== 'COMPONENT_SET') {
    throw new Error(`Component set not found: ${componentSetId}`);
  }

  const componentSet = node as ComponentSetNode;

  // 在子组件中查找匹配的变体
  let target: ComponentNode | null = null;
  for (const child of componentSet.children) {
    if (child.type !== 'COMPONENT') continue;
    const comp = child as ComponentNode;
    const vp = comp.variantProperties;
    if (!vp) continue;

    const match = Object.entries(variantProperties).every(
      ([key, value]) => vp[key] === value
    );

    if (match) {
      target = comp;
      break;
    }
  }

  if (!target) {
    throw new Error(`No variant found matching: ${JSON.stringify(variantProperties)}`);
  }

  const instance = target.createInstance();

  if (parentId) {
    const parent = figma.getNodeById(parentId);
    if (parent && 'children' in parent) {
      (parent as ChildrenMixin).appendChild(instance);
    }
  }

  return {
    id: instance.id,
    name: instance.name,
    type: 'INSTANCE',
    componentId: target.id,
    variantProperties: target.variantProperties,
  };
};

/** 更新变体属性（重命名组件以反映新的变体属性） */
const setVariantProperties: CommandHandler = async (params) => {
  const { componentId, properties } = params as {
    componentId: string;
    properties: Record<string, string>;
  };

  if (!componentId) throw new Error('componentId is required');
  if (!properties) throw new Error('properties is required');

  const node = figma.getNodeById(componentId);
  if (!node || node.type !== 'COMPONENT') {
    throw new Error(`Component not found: ${componentId}`);
  }

  const comp = node as ComponentNode;

  // 获取当前变体属性并合并
  const current = comp.variantProperties || {};
  const merged = { ...current, ...properties };
  comp.name = propertiesToVariantName(merged);

  return {
    id: comp.id,
    name: comp.name,
    properties: comp.variantProperties,
  };
};

export const variantsHandlers: Record<string, CommandHandler> = {
  createComponentSet,
  getComponentSets,
  createVariantInstance,
  setVariantProperties,
};
