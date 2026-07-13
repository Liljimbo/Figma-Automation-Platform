// ============================================================
// @figma-forge/core — Primitive Commands 封装
// Bridge 内部使用，不暴露给 AI
// ============================================================

import type { PrimitiveExecutor } from './types.js';
import type {
  CreateNodeParams,
  CreateTextNodeParams,
  DeleteNodeParams,
  SetPropertiesParams,
  SetLayoutParams,
  MoveNodeParams,
  ExportNodeParams,
  GetNodeTreeParams,
  GetNodePropertiesParams,
  FindNodesParams,
  DuplicateNodeParams,
  GroupNodesParams,
  UngroupNodesParams,
  SwapComponentParams,
  CreateVariableCollectionParams,
  CreateVariableParams,
  GetVariablesParams,
  UpdateVariableValueParams,
  DeleteVariableParams,
  AddVariableModeParams,
  AssignVariableToNodeParams,
  CreateComponentSetParams,
  CreateVariantInstanceParams,
  SetVariantPropertiesParams,
  StartListeningParams,
  SnapshotNodeParams,
} from '@figma-forge/shared';

export class Primitives {
  private execute: PrimitiveExecutor;

  constructor(executor: PrimitiveExecutor) {
    this.execute = executor;
  }

  // ─── Read ────────────────────────────────────────────────

  async getDocumentInfo(): Promise<unknown> {
    return this.execute('getDocumentInfo', {});
  }

  async getNodeTree(params: GetNodeTreeParams = {}): Promise<unknown> {
    return this.execute('getNodeTree', params as unknown as Record<string, unknown>);
  }

  async getNodeProperties(params: GetNodePropertiesParams): Promise<unknown> {
    return this.execute('getNodeProperties', params as unknown as Record<string, unknown>);
  }

  async findNodes(params: FindNodesParams): Promise<unknown> {
    return this.execute('findNodes', params as unknown as Record<string, unknown>);
  }

  async getStyles(params: { nodeId?: string }): Promise<unknown> {
    return this.execute('getStyles', params as unknown as Record<string, unknown>);
  }

  async duplicateNode(params: DuplicateNodeParams): Promise<unknown> {
    return this.execute('duplicateNode', params as unknown as Record<string, unknown>);
  }

  async groupNodes(params: GroupNodesParams): Promise<unknown> {
    return this.execute('groupNodes', params as unknown as Record<string, unknown>);
  }

  async ungroupNodes(params: UngroupNodesParams): Promise<void> {
    await this.execute('ungroupNodes', params as unknown as Record<string, unknown>);
  }

  async swapComponent(params: SwapComponentParams): Promise<unknown> {
    return this.execute('swapComponent', params as unknown as Record<string, unknown>);
  }

  // ─── Create ──────────────────────────────────────────────

  async createNode(params: CreateNodeParams): Promise<{ id: string; name: string; type: string }> {
    const result = await this.execute('createNode', params as unknown as Record<string, unknown>);
    return result as { id: string; name: string; type: string };
  }

  async createTextNode(params: CreateTextNodeParams): Promise<{ id: string; name: string; type: string; characters: string }> {
    const result = await this.execute('createTextNode', params as unknown as Record<string, unknown>);
    return result as { id: string; name: string; type: string; characters: string };
  }

  // ─── Modify ──────────────────────────────────────────────

  async deleteNode(params: DeleteNodeParams): Promise<void> {
    await this.execute('deleteNode', params as unknown as Record<string, unknown>);
  }

  async setProperties(params: SetPropertiesParams): Promise<void> {
    await this.execute('setProperties', params as unknown as Record<string, unknown>);
  }

  async setLayout(params: SetLayoutParams): Promise<void> {
    await this.execute('setLayout', params as unknown as Record<string, unknown>);
  }

  async moveNode(params: MoveNodeParams): Promise<void> {
    await this.execute('moveNode', params as unknown as Record<string, unknown>);
  }

  // ─── Export ──────────────────────────────────────────────

  async exportNode(params: ExportNodeParams): Promise<{ base64: string; format: string; width: number; height: number }> {
    const result = await this.execute('exportNode', params as unknown as Record<string, unknown>);
    return result as { base64: string; format: string; width: number; height: number };
  }

  // ─── Variables ─────────────────────────────────────────────

  async createVariableCollection(params: CreateVariableCollectionParams): Promise<unknown> {
    return this.execute('createVariableCollection', params as unknown as Record<string, unknown>);
  }

  async getVariableCollections(): Promise<unknown> {
    return this.execute('getVariableCollections', {});
  }

  async createVariable(params: CreateVariableParams): Promise<unknown> {
    return this.execute('createVariable', params as unknown as Record<string, unknown>);
  }

  async getVariables(params: GetVariablesParams = {}): Promise<unknown> {
    return this.execute('getVariables', params as unknown as Record<string, unknown>);
  }

  async updateVariableValue(params: UpdateVariableValueParams): Promise<unknown> {
    return this.execute('updateVariableValue', params as unknown as Record<string, unknown>);
  }

  async deleteVariable(params: DeleteVariableParams): Promise<void> {
    await this.execute('deleteVariable', params as unknown as Record<string, unknown>);
  }

  async addVariableMode(params: AddVariableModeParams): Promise<unknown> {
    return this.execute('addVariableMode', params as unknown as Record<string, unknown>);
  }

  async assignVariableToNode(params: AssignVariableToNodeParams): Promise<unknown> {
    return this.execute('assignVariableToNode', params as unknown as Record<string, unknown>);
  }

  // ─── Component Variants ───────────────────────────────────

  async createComponentSet(params: CreateComponentSetParams): Promise<unknown> {
    return this.execute('createComponentSet', params as unknown as Record<string, unknown>);
  }

  async getComponentSets(): Promise<unknown> {
    return this.execute('getComponentSets', {});
  }

  async createVariantInstance(params: CreateVariantInstanceParams): Promise<unknown> {
    return this.execute('createVariantInstance', params as unknown as Record<string, unknown>);
  }

  async setVariantProperties(params: SetVariantPropertiesParams): Promise<unknown> {
    return this.execute('setVariantProperties', params as unknown as Record<string, unknown>);
  }

  // ─── Event Listeners ──────────────────────────────────────

  async startListening(params: StartListeningParams): Promise<unknown> {
    return this.execute('startListening', params as unknown as Record<string, unknown>);
  }

  async stopListening(params: { events?: string[] }): Promise<unknown> {
    return this.execute('stopListening', params as unknown as Record<string, unknown>);
  }

  // ─── Diff Engine ──────────────────────────────────────────

  async snapshotNode(params: SnapshotNodeParams = {}): Promise<unknown> {
    return this.execute('snapshotNode', params as unknown as Record<string, unknown>);
  }
}
