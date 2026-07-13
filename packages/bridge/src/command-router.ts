// ============================================================
// @figma-forge/core — 命令路由器
// 管理命令的发送、超时、结果匹配
// ============================================================

import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import type { PrimitiveCommand, CommandResult } from '@figma-forge/shared';

/** 待处理的命令回调 */
interface PendingCommand {
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandRouter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCommand>();

  /** 设置 WebSocket 连接 */
  setSocket(ws: WebSocket) {
    this.ws = ws;
  }

  /** 清除 WebSocket 连接 */
  clearSocket() {
    this.ws = null;
  }

  /** 发送命令到 Plugin 并等待结果 */
  async sendCommand(
    cmd: string,
    params: Record<string, unknown> = {}
  ): Promise<CommandResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Plugin not connected');
    }

    const id = uuidv4();

    const command: PrimitiveCommand = { id, cmd: cmd as PrimitiveCommand['cmd'], params };

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command timeout after ${config.commandTimeout}ms: ${cmd}`));
      }, config.commandTimeout);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({
        type: 'command',
        payload: command,
      }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Failed to send command: ${err.message}`));
        }
      });
    });
  }

  /** 处理 Plugin 返回的结果 */
  handleResult(result: CommandResult) {
    const pending = this.pending.get(result.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    pending.resolve(result);
  }

  /** 清理所有待处理命令 */
  cleanup() {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection lost'));
    }
    this.pending.clear();
  }
}
