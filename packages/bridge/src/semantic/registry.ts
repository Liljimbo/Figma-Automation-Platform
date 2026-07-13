// ============================================================
// @figma-bridge/bridge — 语义注册表
// 维护 nodeId → SemanticEntry 的映射
//
// 设计决策：注册表仅在内存中维护，不持久化。
// 这是 Phase 2 的有意设计——每次 MCP Server 启动时注册表为空，
// AI 需要在需要时通过 get_semantic_map 重新发现节点。
// 持久化存储将在 Phase 3 中实现。
// ============================================================

import type { SemanticEntry, RegistryFilter } from './types.js';

export class SemanticRegistry {
  private entries = new Map<string, SemanticEntry>();

  /** 注册一个语义节点 */
  register(entry: SemanticEntry): void {
    this.entries.set(entry.nodeId, entry);
  }

  /** 注销一个语义节点 */
  unregister(nodeId: string): boolean {
    return this.entries.delete(nodeId);
  }

  /** 按 nodeId 查找 */
  get(nodeId: string): SemanticEntry | undefined {
    return this.entries.get(nodeId);
  }

  /** 按类型查找 */
  findByType(type: string): SemanticEntry[] {
    const results: SemanticEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.type === type) {
        results.push(entry);
      }
    }
    return results;
  }

  /** 按名称查找 */
  findByName(name: string): SemanticEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.name === name) {
        return entry;
      }
    }
    return undefined;
  }

  /** 按过滤器查找 */
  findAll(filter?: RegistryFilter): SemanticEntry[] {
    if (!filter || Object.keys(filter).length === 0) {
      return Array.from(this.entries.values());
    }

    const results: SemanticEntry[] = [];

    for (const entry of this.entries.values()) {
      if (filter.type && entry.type !== filter.type) continue;

      if (filter.name && entry.name !== filter.name) continue;

      if (filter.namePattern) {
        const regex = new RegExp(
          '^' + filter.namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i'
        );
        if (!regex.test(entry.name)) continue;
      }

      results.push(entry);
    }

    return results;
  }

  /** 获取完整映射 */
  getMap(): Map<string, SemanticEntry> {
    return new Map(this.entries);
  }

  /** 获取条目总数 */
  get size(): number {
    return this.entries.size;
  }

  /** 清空注册表 */
  clear(): void {
    this.entries.clear();
  }
}
