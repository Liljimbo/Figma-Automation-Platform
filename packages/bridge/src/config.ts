// ============================================================
// @figma-bridge/bridge — 配置管理
// ============================================================

export interface BridgeConfig {
  /** WebSocket 服务端口 */
  wsPort: number;
  /** 命令超时时间（毫秒） */
  commandTimeout: number;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const config: BridgeConfig = {
  wsPort: parseInt(process.env.BRIDGE_WS_PORT || '37849', 10),
  commandTimeout: parseInt(process.env.BRIDGE_COMMAND_TIMEOUT || '30000', 10),
  logLevel: (process.env.BRIDGE_LOG_LEVEL as BridgeConfig['logLevel']) || 'info',
};

export default config;
