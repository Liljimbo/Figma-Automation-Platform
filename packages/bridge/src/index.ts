// ============================================================
// @figma-forge/core — 入口
// 启动 WebSocket Server + MCP Server
// ============================================================

import { CommandRouter } from './command-router.js';
import { WSServer } from './ws-server.js';
import { BridgeMCPServer } from './mcp-server.js';
import { HttpServer } from './http-server.js';
import config from './config.js';
import type { PluginEvent } from '@figma-forge/shared';

/** 内存事件队列 */
const eventQueue: PluginEvent[] = [];
const MAX_EVENTS = 1000;

async function main() {
  console.error('=== Figma Forge Server v0.1.0 ===');

  // 1. 创建命令路由器
  const commandRouter = new CommandRouter();

  // 2. 创建并启动 WebSocket Server
  const wsServer = new WSServer(commandRouter);

  wsServer.onStatus((status) => {
    if (status === 'connected') {
      console.error('[Bridge] ✅ Plugin connected — ready to accept commands');
    } else {
      console.error('[Bridge] ⚠️  Plugin disconnected — waiting for reconnection...');
    }
  });

  // 事件队列：Plugin 推送的事件存储在这里
  wsServer.onEvent((event: PluginEvent) => {
    eventQueue.push(event);
    if (eventQueue.length > MAX_EVENTS) {
      eventQueue.splice(0, eventQueue.length - MAX_EVENTS);
    }
  });

  try {
    await wsServer.start();
  } catch (err) {
    console.error('[Bridge] Failed to start WebSocket server:', err);
    process.exit(1);
  }

  // 3. 创建并启动 MCP Server
  const mcpServer = new BridgeMCPServer(commandRouter, eventQueue);

  try {
    await mcpServer.start();
    console.error('[Bridge] ✅ MCP Server started (stdio)');
    console.error('[Bridge] Waiting for Claude Code to connect via MCP...');
  } catch (err) {
    console.error('[Bridge] Failed to start MCP server:', err);
    process.exit(1);
  }

  // 4. 启动 HTTP REST API Server
  const httpServer = new HttpServer(mcpServer.getSemanticTools(), config.httpPort);

  try {
    await httpServer.start();
    console.error(`[Bridge] ✅ REST API started (http://${config.host}:${config.httpPort})`);
  } catch (err) {
    console.error('[Bridge] Failed to start HTTP server:', err);
    // HTTP 失败不阻塞，MCP 仍可工作
  }

  // 5. 优雅退出
  process.on('SIGINT', () => {
    console.error('\n[Bridge] Shutting down...');
    wsServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('\n[Bridge] Shutting down...');
    wsServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Bridge] Fatal error:', err);
  process.exit(1);
});
