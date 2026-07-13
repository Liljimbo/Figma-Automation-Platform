// ============================================================
// @figma-bridge/bridge — Primitive Commands 封装
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
} from '@figma-bridge/shared';

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
}
