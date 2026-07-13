// ============================================================
// @figma-bridge/shared — 统一类型定义
// ============================================================

// ─── Primitive Commands（Bridge → Plugin）──────────────────

/** 所有可用的 Primitive Command 类型 */
export type PrimitiveCommandType =
  | 'getDocumentInfo'
  | 'getNodeTree'
  | 'getNodeProperties'
  | 'getStyles'
  | 'findNodes'
  | 'createNode'
  | 'createTextNode'
  | 'deleteNode'
  | 'setProperties'
  | 'setLayout'
  | 'moveNode'
  | 'batchCreate'
  | 'batchSetProperties'
  | 'exportNode'
  | 'duplicateNode'
  | 'groupNodes'
  | 'ungroupNodes'
  | 'swapComponent'
  // Variables
  | 'createVariableCollection'
  | 'getVariableCollections'
  | 'createVariable'
  | 'getVariables'
  | 'updateVariableValue'
  | 'deleteVariable'
  | 'addVariableMode'
  | 'assignVariableToNode'
  // Component Variants
  | 'createComponentSet'
  | 'getComponentSets'
  | 'createVariantInstance'
  | 'setVariantProperties'
  // Event Listeners
  | 'startListening'
  | 'stopListening'
  | 'getPendingEvents';

/** 发送给 Plugin 的原始命令 */
export interface PrimitiveCommand {
  id: string;
  cmd: PrimitiveCommandType;
  params: Record<string, unknown>;
}

/** Plugin 返回的执行结果 */
export interface CommandResult {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Read Commands ─────────────────────────────────────────

export interface GetDocumentInfoParams {
  // 无参数
}

export interface DocumentInfo {
  name: string;
  id: string;
  pages: Array<{ id: string; name: string }>;
}

export interface GetNodeTreeParams {
  nodeId?: string;    // 不传则从根节点开始
  depth?: number;     // 递归深度，默认 3
}

export interface TreeNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  children?: TreeNode[];
}

export interface GetNodePropertiesParams {
  nodeId: string;
  properties?: string[];  // 不传则返回所有属性
}

export interface FindNodesParams {
  name?: string;        // 名称匹配（支持 * 通配符）
  type?: string;        // 节点类型过滤
  pageId?: string;      // 指定页面
  recursive?: boolean;  // 是否递归搜索子节点
  maxDepth?: number;    // 递归搜索最大深度
  propertyFilter?: Record<string, unknown>; // 按属性值过滤
}

// ─── Create Commands ───────────────────────────────────────

export type LayoutDirection = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

export interface CreateNodeParams {
  type: 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'COMPONENT' | 'INSTANCE';
  name: string;
  parentId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: Array<{
    type: 'SOLID' | 'GRADIENT_LINEAR' | 'IMAGE';
    color?: { r: number; g: number; b: number; a?: number };
    opacity?: number;
    url?: string;
  }>;
  strokes?: Array<{
    type: 'SOLID';
    color: { r: number; g: number; b: number; a?: number };
  }>;
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: Array<{
    type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR';
    offset?: { x: number; y: number };
    radius?: number;
    color?: { r: number; g: number; b: number; a?: number };
    spread?: number;
  }>;
  opacity?: number;
  visible?: boolean;
}

export interface CreateTextNodeParams {
  content: string;
  name?: string;
  parentId?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  color?: { r: number; g: number; b: number; a?: number };
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

// ─── Modify Commands ───────────────────────────────────────

export interface DeleteNodeParams {
  nodeId: string;
}

export interface SetPropertiesParams {
  nodeId: string;
  properties: Record<string, unknown>;
}

export interface SetLayoutParams {
  nodeId: string;
  direction?: LayoutDirection;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
}

export interface MoveNodeParams {
  nodeId: string;
  newParentId: string;
  index?: number;
}

// ─── Export Commands ───────────────────────────────────────

export interface ExportNodeParams {
  nodeId: string;
  format?: 'PNG' | 'JPG' | 'SVG' | 'PDF';
  scale?: number;
}

// ─── Additional Commands ──────────────────────────────────

export interface DuplicateNodeParams {
  nodeId: string;
  name?: string;
}

export interface GroupNodesParams {
  nodeIds: string[];
  name?: string;
}

export interface UngroupNodesParams {
  nodeId: string;
}

export interface SwapComponentParams {
  nodeId: string;
  componentName: string;
}

// ─── Variables Commands ────────────────────────────────────

export type VariableResolvedType = 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';

export interface CreateVariableCollectionParams {
  name: string;
  modes: string[];
}

export interface CreateVariableParams {
  name: string;
  collectionId: string;
  resolvedType: VariableResolvedType;
  valuesByMode: Record<string, unknown>;
}

export interface GetVariablesParams {
  type?: VariableResolvedType;
  collectionId?: string;
}

export interface UpdateVariableValueParams {
  variableId: string;
  modeId: string;
  value: unknown;
}

export interface DeleteVariableParams {
  variableId: string;
}

export interface AddVariableModeParams {
  collectionId: string;
  modeName: string;
}

export interface AssignVariableToNodeParams {
  variableId: string;
  nodeId: string;
  property: string;
}

// ─── Component Variants Commands ──────────────────────────

export interface VariantDefinition {
  name: string;
  properties: Record<string, string>;
  width?: number;
  height?: number;
  fills?: CreateNodeParams['fills'];
}

export interface CreateComponentSetParams {
  name: string;
  variants: VariantDefinition[];
  parentId?: string;
}

export interface CreateVariantInstanceParams {
  componentSetId: string;
  variantProperties: Record<string, string>;
  parentId?: string;
}

export interface SetVariantPropertiesParams {
  componentId: string;
  properties: Record<string, string>;
}

// ─── Event Listener Commands ─────────────────────────────

export interface StartListeningParams {
  events: Array<'selectionchange' | 'documentchange' | 'currentpagechange'>;
}

export interface GetPendingEventsParams {
  since?: number;
}

export interface PluginEvent {
  event: string;
  timestamp: number;
  data?: unknown;
}

// ─── Semantic Layer Types ──────────────────────────────────

/** 语义注册表条目 */
export interface SemanticEntry {
  nodeId: string;
  type: string;
  name: string;
  createdAt: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

/** Semantic Tool 定义（用于 MCP 注册） */
export interface SemanticToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

/** Semantic Tool 执行结果 */
export interface SemanticResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── WebSocket Protocol ────────────────────────────────────

/** WebSocket 消息格式 */
export interface WSMessage {
  type: 'command' | 'result' | 'ping' | 'pong' | 'error';
  payload: PrimitiveCommand | CommandResult | { message: string };
}

// ─── JSON Schema Helper ────────────────────────────────────

export type JSONSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: Record<string, unknown>;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
};
