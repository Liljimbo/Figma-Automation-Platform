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
      this.wss = new WebSocketServer({ port: config.wsPort, host: config.host });

      this.wss.on('listening', () => {
        console.error(`[WS] Server listening on ${config.host}:${config.wsPort}`);
        resolve();
      });

      this.wss.on('error', (err) => {
        console.error('[WS] Server error:', err.message);
        reject(err);
      });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.error(`[WS] Client connected from ${clientIp}`);

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'hello' && msg.payload?.client === 'figma-plugin') {
              if (this.pluginSocket && this.pluginSocket !== ws) {
                this.commandRouter.cleanup();
                this.pluginSocket.close(1000, 'Replaced by a newer plugin connection');
              }
              this.pluginSocket = ws;
              this.commandRouter.setSocket(ws);
              this.onStatusChange?.('connected');
            } else if (ws === this.pluginSocket && msg.type === 'result'
              && typeof msg.payload?.id === 'string' && typeof msg.payload?.success === 'boolean') {
              this.commandRouter.handleResult(msg.payload);
            } else if (ws === this.pluginSocket && msg.type === 'event'
              && typeof msg.payload?.event === 'string' && typeof msg.payload?.timestamp === 'number') {
              this.onEventCallback?.(msg.payload);
            }
          } catch (err) {
            console.error('[WS] Message parse error:', err);
          }
        });

        ws.on('close', () => {
          if (ws === this.pluginSocket) {
            console.error('[WS] Plugin disconnected');
            this.pluginSocket = null;
            this.commandRouter.clearSocket();
            this.commandRouter.cleanup();
            this.onStatusChange?.('disconnected');
          }
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
