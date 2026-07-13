// ============================================================
// @figma-bridge/bridge — MCP Server
// 通过 stdio 暴露 Semantic Tools 给 Claude Code
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SemanticTools, TOOL_DEFINITIONS } from './semantic/tools.js';
import type { PrimitiveExecutor } from './semantic/types.js';
import { CommandRouter } from './command-router.js';

export class BridgeMCPServer {
  private mcp: McpServer;
  private semanticTools: SemanticTools;
  private transport: StdioServerTransport;

  constructor(commandRouter: CommandRouter) {
    // 创建 Primitive Executor —— 通过 CommandRouter 发送命令到 Plugin
    const executor: PrimitiveExecutor = async (cmd, params) => {
      const result = await commandRouter.sendCommand(cmd, params);
      if (!result.success) {
        throw new Error(result.error || 'Command failed');
      }
      return result.data;
    };

    this.semanticTools = new SemanticTools(executor);

    // 创建 MCP Server
    this.mcp = new McpServer({
      name: 'figma-bridge',
      version: '0.1.0',
    });

    this.transport = new StdioServerTransport();

    // 注册所有 Semantic Tools
    this.registerTools();
  }

  private registerTools() {
    for (const toolDef of TOOL_DEFINITIONS) {
      // MCP SDK tool(name, description, handler) — 不传 schema
      // 参数验证在 handler 内部处理
      this.mcp.tool(
        toolDef.name,
        toolDef.description,
        async (params: Record<string, unknown>) => {
          const result = await this.semanticTools.execute(toolDef.name, params);

          if (result.success) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result.data, null, 2),
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
        }
      );
    }

    console.log(`[MCP] Registered ${TOOL_DEFINITIONS.length} tools`);
  }

  /** 获取语义注册表（用于其他模块查询） */
  getRegistry() {
    return this.semanticTools.getRegistry();
  }

  /** 启动 MCP Server */
  async start() {
    await this.mcp.connect(this.transport);
    console.log('[MCP] Server started (stdio)');
  }
}
