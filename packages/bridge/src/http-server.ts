// ============================================================
// @figma-bridge/bridge — HTTP REST API Server
// 作为 MCP 的补充，提供 HTTP 接口
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { SemanticTools } from './semantic/tools.js';
import { TOOL_DEFINITIONS } from './semantic/tools.js';

export class HttpServer {
  private server: ReturnType<typeof createServer> | null = null;
  private semanticTools: SemanticTools;
  private port: number;

  constructor(semanticTools: SemanticTools, port = 37850) {
    this.semanticTools = semanticTools;
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 路由
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);
        const path = url.pathname;

        try {
          if (req.method === 'GET' && path === '/health') {
            this.json(res, 200, { status: 'ok', version: '0.1.0' });
          } else if (req.method === 'GET' && path === '/tools') {
            // 列出所有可用工具
            this.json(res, 200, {
              tools: TOOL_DEFINITIONS,
              count: TOOL_DEFINITIONS.length,
              note: 'Use POST /tools/:toolName to call a tool',
            });
          } else if (req.method === 'POST' && path.startsWith('/tools/')) {
            // 调用工具
            const toolName = path.slice('/tools/'.length);
            const body = await this.readBody(req);
            const params = body ? JSON.parse(body) : {};

            const result = await this.semanticTools.execute(toolName, params);

            if (result.success) {
              this.json(res, 200, result);
            } else {
              this.json(res, 400, result);
            }
          } else {
            this.json(res, 404, { error: 'Not found', availableEndpoints: [
              'GET  /health',
              'GET  /tools',
              'POST /tools/:toolName',
            ]});
          }
        } catch (err) {
          this.json(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      this.server.listen(this.port, () => {
        console.log(`[HTTP] REST API listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('[HTTP] Server error:', err.message);
        reject(err);
      });
    });
  }

  close() {
    this.server?.close();
  }

  private json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}
