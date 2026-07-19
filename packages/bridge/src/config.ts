// ============================================================
// @figma-forge/core — 配置管理
// ============================================================

export interface BridgeConfig {
  /** 服务监听地址；默认仅允许本机访问 */
  host: string;
  /** WebSocket 服务端口 */
  wsPort: number;
  /** HTTP REST API 端口 */
  httpPort: number;
  /** 命令超时时间（毫秒） */
  commandTimeout: number;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** REST 可选访问令牌 */
  authToken?: string;
  /** REST 请求体上限（字节） */
  maxBodyBytes: number;
}

const config: BridgeConfig = {
  host: process.env.BRIDGE_HOST || '127.0.0.1',
  wsPort: parseInt(process.env.BRIDGE_WS_PORT || '37849', 10),
  httpPort: parseInt(process.env.BRIDGE_HTTP_PORT || '37850', 10),
  commandTimeout: parseInt(process.env.BRIDGE_COMMAND_TIMEOUT || '30000', 10),
  logLevel: (process.env.BRIDGE_LOG_LEVEL as BridgeConfig['logLevel']) || 'info',
  authToken: process.env.BRIDGE_AUTH_TOKEN || undefined,
  maxBodyBytes: parseInt(process.env.BRIDGE_MAX_BODY_BYTES || '1048576', 10),
};

export default config;
