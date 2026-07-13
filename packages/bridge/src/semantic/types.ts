// ============================================================
// @figma-forge/core — 语义层类型定义
// ============================================================

import type { SemanticEntry, PrimitiveCommandType, SemanticToolDefinition, SemanticResult } from '@figma-forge/shared';

/** 语义注册表查询过滤器 */
export interface RegistryFilter {
  type?: string;
  name?: string;
  namePattern?: string;  // 支持 * 通配符
}

/** Primitive Command 执行函数类型 */
export type PrimitiveExecutor = (
  cmd: PrimitiveCommandType,
  params: Record<string, unknown>
) => Promise<unknown>;

export type { SemanticEntry, SemanticToolDefinition, SemanticResult };
