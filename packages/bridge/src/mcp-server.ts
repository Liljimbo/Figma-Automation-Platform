// ============================================================
// @figma-forge/core — MCP Server
// 通过 stdio 暴露 Semantic Tools 给 Claude Code
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SemanticTools, TOOL_DEFINITIONS } from './semantic/tools.js';
import type { PrimitiveExecutor } from './semantic/types.js';
import { CommandRouter } from './command-router.js';
import type { PluginEvent } from '@figma-forge/shared';

/** 将 JSON Schema properties 转换为 Zod raw shape，供 MCP SDK 暴露 inputSchema */
function jsonSchemaToZodShape(
  properties: Record<string, { type?: string; enum?: string[]; items?: { type?: string; properties?: Record<string, unknown> }; description?: string; default?: unknown }> = {},
  required: string[] = []
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    if (prop.type === 'number') {
      field = z.number();
    } else if (prop.type === 'boolean') {
      field = z.boolean();
    } else if (prop.type === 'array') {
      if (prop.items?.type === 'object' && prop.items?.properties) {
        // 递归处理对象数组（如 batch_execute 的 commands）
        const innerShape = jsonSchemaToZodShape(prop.items.properties as Record<string, { type?: string; enum?: string[]; items?: { type?: string; properties?: Record<string, unknown> }; description?: string; default?: unknown }>);
        field = z.array(z.object(innerShape));
      } else {
        field = z.array(z.string());
      }
    } else if (prop.type === 'object') {
      field = z.record(z.string(), z.unknown());
    } else if (prop.enum && prop.enum.length >= 2) {
      field = z.enum(prop.enum as [string, ...string[]]);
    } else {
      field = z.string();
    }
    if (prop.description) {
      field = field.describe(prop.description);
    }
    // 非必填字段设为 optional
    if (!required.includes(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }
  return shape;
}

export class BridgeMCPServer {
  private mcp: McpServer;
  private semanticTools: SemanticTools;
  private transport: StdioServerTransport;

  constructor(commandRouter: CommandRouter, eventQueue: PluginEvent[] = []) {
    const executor: PrimitiveExecutor = async (cmd, params) => {
      const result = await commandRouter.sendCommand(cmd, params);
      if (!result.success) {
        throw new Error(result.error || 'Command failed');
      }
      return result.data;
    };

    this.semanticTools = new SemanticTools(executor, eventQueue);

    this.mcp = new McpServer({
      name: 'figma-forge',
      version: '0.1.0',
    });

    this.transport = new StdioServerTransport();
    this.registerTools();
  }

  private registerTools() {
    for (const toolDef of TOOL_DEFINITIONS) {
      const zodShape = toolDef.inputSchema?.properties
        ? jsonSchemaToZodShape(
            toolDef.inputSchema.properties as Record<string, { type?: string; enum?: string[]; items?: { type?: string }; description?: string }>,
            (toolDef.inputSchema as { required?: string[] }).required || []
          )
        : undefined;

      const handler = async (params: Record<string, unknown>) => {
        const result = await this.semanticTools.execute(toolDef.name, params);

        if (result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result.data ?? null, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${result.error}`,
              },
            ],
            isError: true,
          };
        }
      };

      if (zodShape && Object.keys(zodShape).length > 0) {
        this.mcp.tool(toolDef.name, toolDef.description, zodShape, handler);
      } else {
        this.mcp.tool(toolDef.name, toolDef.description, handler);
      }
    }

    console.log(`[MCP] Registered ${TOOL_DEFINITIONS.length} tools`);
  }

  getRegistry() {
    return this.semanticTools.getRegistry();
  }

  getSemanticTools() {
    return this.semanticTools;
  }

  async start() {
    await this.mcp.connect(this.transport);
    console.log('[MCP] Server started (stdio)');
  }
}
