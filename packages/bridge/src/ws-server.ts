// ============================================================
// @figma-forge/core — WebSocket Server
// 管理与 Figma Plugin 的连接
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import config from './config.js';
import { CommandRouter } from './command-router.js';

export class WSServer {
  private wss: WebSocketServer | null = null;
  private pluginSocket: WebSocket | null = null;
  private commandRouter: CommandRouter;
  private onStatusChange?: (status: 'connected' | 'disconnected') => void;
  private onEventCallback?: (event: { event: string; timestamp: number; data?: unknown }) => void;

  constructor(commandRouter: CommandRouter) {
    this.commandRouter = commandRouter;
  }

  /** 设置状态变化回调 */
  onStatus(callback: (status: 'connected' | 'disconnected') => void) {
    this.onStatusChange = callback;
  }

  /** 设置事件回调 */
  onEvent(callback: (event: { event: string; timestamp: number; data?: unknown }) => void) {
    this.onEventCallback = callback;
  }

  /** 启动 WebSocket 服务 */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: config.wsPort });

      this.wss.on('listening', () => {
        console.log(`[WS] Server listening on port ${config.wsPort}`);
        resolve();
      });

      this.wss.on('error', (err) => {
        console.error('[WS] Server error:', err.message);
        reject(err);
      });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS] Client connected from ${clientIp}`);

        // 保持所有连接，不替换旧连接
        // Plugin 连接和测试客户端可以共存
        if (!this.pluginSocket || this.pluginSocket.readyState !== WebSocket.OPEN) {
          this.pluginSocket = ws;
          this.commandRouter.setSocket(ws);
          this.onStatusChange?.('connected');
        }

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'result') {
              this.commandRouter.handleResult(msg.payload);
            } else if (msg.type === 'event') {
              this.onEventCallback?.(msg.payload);
            }
          } catch (err) {
            console.error('[WS] Message parse error:', err);
          }
        });

        ws.on('close', () => {
          console.log('[WS] Plugin disconnected');
          this.pluginSocket = null;
          this.commandRouter.clearSocket();
          this.commandRouter.cleanup();
          this.onStatusChange?.('disconnected');
        });

        ws.on('error', (err) => {
          console.error('[WS] Socket error:', err.message);
        });
      });
    });
  }

  /** 检查 Plugin 是否已连接 */
  isConnected(): boolean {
    return (
      this.pluginSocket !== null &&
      this.pluginSocket.readyState === WebSocket.OPEN
    );
  }

  /** 关闭服务 */
  close() {
    this.pluginSocket?.close();
    this.wss?.close();
  }
}
