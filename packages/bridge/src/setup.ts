// ============================================================
// @figma-bridge/bridge — Setup 逻辑
// 一键安装：复制 Plugin 文件 + 配置 MCP
// ============================================================

import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

export interface SetupOptions {
  pluginDir?: string;
  mcpConfig?: string;
  projectDir?: string;
}

const DEFAULT_PLUGIN_DIR = join(homedir(), '.figma-bridge', 'plugin');

/** 获取当前包的根目录（包含 plugin 构建产物） */
function getPackageDir(): string {
  // 从 dist/setup.js 向上两级到 packages/bridge/
  return resolve(import.meta.dirname || __dirname, '..');
}

/** 获取 plugin 包目录 */
function getPluginSourceDir(): string {
  const bridgeDir = getPackageDir();
  return resolve(bridgeDir, '..', 'plugin');
}

/** 复制 Plugin 文件到目标目录 */
export function copyPluginFiles(targetDir: string): void {
  const pluginSrc = getPluginSourceDir();

  if (!existsSync(pluginSrc)) {
    throw new Error(`Plugin source not found at: ${pluginSrc}`);
  }

  mkdirSync(targetDir, { recursive: true });

  // 需要复制的文件
  const files = [
    'manifest.json',
    'dist/code.js',
  ];

  // ui.html 在 src/ 目录（esbuild 不处理它）
  const uiSrc = join(pluginSrc, 'src', 'ui.html');
  const uiDist = join(pluginSrc, 'dist', 'ui.html');
  const uiSource = existsSync(uiDist) ? uiDist : uiSrc;

  for (const file of files) {
    const src = join(pluginSrc, file);
    const dest = join(targetDir, file);
    const destDir = join(dest, '..');
    mkdirSync(destDir, { recursive: true });

    if (!existsSync(src)) {
      console.warn(`  ⚠️  Skipping ${file} (not found, run pnpm build first)`);
      continue;
    }

    copyFileSync(src, dest);
  }

  // 复制 ui.html
  if (existsSync(uiSource)) {
    copyFileSync(uiSource, join(targetDir, 'ui.html'));
  }

  console.log(`  ✅ Plugin files copied to: ${targetDir}`);
}

/** 配置 MCP */
export function configureMcp(projectDir?: string): string {
  const mcpConfig = {
    mcpServers: {
      'figma-bridge': {
        command: 'node',
        args: [join(getPackageDir(), 'dist', 'index.js')],
      },
    },
  };

  const configPath = projectDir
    ? join(projectDir, '.mcp.json')
    : join(process.cwd(), '.mcp.json');

  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`  ✅ MCP config written to: ${configPath}`);

  return configPath;
}

/** 打印使用说明 */
export function printInstructions(pluginDir: string, mcpConfigPath: string): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Figma Bridge — Setup Complete!');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Next steps:');
  console.log('');
  console.log('  1. Install the Figma Plugin:');
  console.log('     - Open Figma Desktop');
  console.log('     - Plugins → Development → Import plugin from manifest');
  console.log(`     - Select: ${join(pluginDir, 'manifest.json')}`);
  console.log('');
  console.log('  2. Start the Bridge Server:');
  console.log('     npx figma-bridge');
  console.log('     (or: node packages/bridge/dist/index.js)');
  console.log('');
  console.log('  3. Run the Plugin in Figma:');
  console.log('     - Right-click → Plugins → figma-bridge');
  console.log('     - UI should show "Connected to Bridge"');
  console.log('');
  console.log('  4. Use with Claude Code:');
  console.log(`     MCP config: ${mcpConfigPath}`);
  console.log('     Claude Code will auto-detect the .mcp.json file');
  console.log('');
  console.log('  5. REST API (optional):');
  console.log('     curl http://localhost:37850/health');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
}

/** 运行 setup 流程 */
export function runSetup(options: SetupOptions = {}): void {
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const mcpConfigPath = options.mcpConfig || options.projectDir || process.cwd();

  console.log('');
  console.log('🔧 Figma Bridge Setup');
  console.log('');

  // 1. 检查 Node.js 版本
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major < 18) {
    console.error(`❌ Node.js >= 18 required (current: ${nodeVersion})`);
    process.exit(1);
  }
  console.log(`  ✅ Node.js ${nodeVersion}`);

  // 2. 复制 Plugin 文件
  console.log('');
  console.log('📦 Installing Figma Plugin...');
  copyPluginFiles(pluginDir);

  // 3. 配置 MCP
  console.log('');
  console.log('⚙️  Configuring MCP...');
  const configPath = configureMcp(options.projectDir);

  // 4. 打印说明
  printInstructions(pluginDir, configPath);
}
