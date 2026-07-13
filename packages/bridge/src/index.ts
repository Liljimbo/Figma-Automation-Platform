// ============================================================
// @figma-bridge/bridge — 入口
// 启动 WebSocket Server + MCP Server
// ============================================================

import { CommandRouter } from './command-router.js';
import { WSServer } from './ws-server.js';
import { BridgeMCPServer } from './mcp-server.js';
import type { PluginEvent } from '@figma-bridge/shared';

/** 内存事件队列 */
const eventQueue: PluginEvent[] = [];
const MAX_EVENTS = 1000;

async function main() {
  console.log('=== Figma Bridge Server v0.1.0 ===');
  console.log('');

  // 1. 创建命令路由器
  const commandRouter = new CommandRouter();

  // 2. 创建并启动 WebSocket Server
  const wsServer = new WSServer(commandRouter);

  wsServer.onStatus((status) => {
    if (status === 'connected') {
      console.log('[Bridge] ✅ Plugin connected — ready to accept commands');
    } else {
      console.log('[Bridge] ⚠️  Plugin disconnected — waiting for reconnection...');
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
    console.log('[Bridge] ✅ MCP Server started (stdio)');
    console.log('');
    console.log('[Bridge] Waiting for Claude Code to connect via MCP...');
    console.log('[Bridge] Make sure Plugin is running in Figma');
    console.log('');
  } catch (err) {
    console.error('[Bridge] Failed to start MCP server:', err);
    process.exit(1);
  }

  // 4. 优雅退出
  process.on('SIGINT', () => {
    console.log('\n[Bridge] Shutting down...');
    wsServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Bridge] Shutting down...');
    wsServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Bridge] Fatal error:', err);
  process.exit(1);
});
