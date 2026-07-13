// ============================================================
// @figma-forge/shared — 统一类型定义
// ============================================================

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
  | 'exportNode'
  | 'duplicateNode'
  | 'groupNodes'
  | 'ungroupNodes'
  | 'swapComponent'
  | 'createVariableCollection'
  | 'getVariableCollections'
  | 'createVariable'
  | 'getVariables'
  | 'updateVariableValue'
  | 'deleteVariable'
  | 'addVariableMode'
  | 'assignVariableToNode'
  | 'createComponentSet'
  | 'getComponentSets'
  | 'createVariantInstance'
  | 'setVariantProperties'
  | 'startListening'
  | 'stopListening'
  | 'getPendingEvents'
  | 'snapshotNode'
  | 'createFromTemplate';

export interface PrimitiveCommand {
  id: string;
  cmd: PrimitiveCommandType;
  params: Record<string, unknown>;
}

export interface CommandResult {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface GetDocumentInfoParams {}

export interface DocumentInfo {
  name: string;
  id: string;
  pages: Array<{ id: string; name: string }>;
}

export interface GetNodeTreeParams {
  nodeId?: string;
  depth?: number;
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
  properties?: string[];
}

export interface FindNodesParams {
  name?: string;
  type?: string;
  pageId?: string;
  recursive?: boolean;
  maxDepth?: number;
  propertyFilter?: Record<string, unknown>;
}

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

export interface ExportNodeParams {
  nodeId: string;
  format?: 'PNG' | 'JPG' | 'SVG' | 'PDF';
  scale?: number;
}

export interface DuplicateNodeParams {
  nodeId: string;
  name?: string;
  newName?: string;
  newParentId?: string;
  offset?: { x: number; y: number };
}

export interface GroupNodesParams {
  nodeIds: string[];
  name?: string;
}

export interface UngroupNodesParams {
  nodeId?: string;
  nodeIds?: string[];
}

export interface SwapComponentParams {
  nodeId?: string;
  instanceId?: string;
  componentName?: string;
  newComponentId?: string;
}

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

export interface NodeSnapshot {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  children?: NodeSnapshot[];
}

export interface SnapshotNodeParams {
  nodeId?: string;
  depth?: number;
}

export interface NodeDiff {
  id: string;
  type: 'add' | 'remove' | 'modify';
  name?: string;
  properties?: Record<string, unknown>;
  parentId?: string;
}

export interface TemplateDefinition {
  name: string;
  description: string;
  tools: Array<{ tool: string; params: Record<string, unknown> }>;
  parameters?: Record<string, { type: string; description: string; default?: unknown }>;
}

export interface CreateFromTemplateParams {
  templateName: string;
  parameters?: Record<string, unknown>;
  parentId?: string;
}

export interface SemanticEntry {
  nodeId: string;
  type: string;
  name: string;
  createdAt: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

export interface SemanticResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface WSMessage {
  type: 'command' | 'result' | 'ping' | 'pong' | 'error';
  payload: PrimitiveCommand | CommandResult | { message: string };
}

export type JSONSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: Record<string, unknown>;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
};
