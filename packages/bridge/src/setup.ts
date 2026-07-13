// ============================================================
// @figma-forge/core — Setup 逻辑
// 一键安装：复制 Plugin 文件 + 配置 MCP
// ============================================================

import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

export interface SetupOptions {
  pluginDir?: string;
  mcpConfig?: string;
  projectDir?: string;
}

const DEFAULT_PLUGIN_DIR = join(homedir(), '.figma-forge', 'plugin');

/**
 * 获取当前包的根目录（packages/bridge/）
 * dist/setup.js → dist/ → packages/bridge/
 */
function getPackageDir(): string {
  return resolve(import.meta.dirname || __dirname, '..');
}

/**
 * 获取 plugin 构建产物目录
 * 优先查找 npm 安装模式（bridge/dist/plugin/），回退到源码模式（packages/plugin/）
 */
function getPluginSourceDir(): string {
  const bridgeDir = getPackageDir();

  // npm 安装模式：plugin 文件已嵌入 bridge/dist/plugin/
  const npmPath = resolve(bridgeDir, 'dist', 'plugin');
  if (existsSync(npmPath) && existsSync(join(npmPath, 'manifest.json'))) {
    return npmPath;
  }

  // 源码开发模式：packages/plugin/
  const sourcePath = resolve(bridgeDir, '..', 'plugin');
  if (existsSync(sourcePath) && existsSync(join(sourcePath, 'manifest.json'))) {
    return sourcePath;
  }

  // 都找不到时返回源码路径（后续会报错）
  return sourcePath;
}

/** 复制 Plugin 文件到目标目录 */
export function copyPluginFiles(targetDir: string): void {
  const pluginSrc = getPluginSourceDir();

  if (!existsSync(pluginSrc)) {
    throw new Error(`Plugin source not found at: ${pluginSrc}`);
  }

  mkdirSync(targetDir, { recursive: true });

  // 需要复制的文件（仅 Figma Plugin 运行所需的最小文件集）
  const files: [string, string][] = [
    ['manifest.json', 'manifest.json'],
    ['ui.html', 'ui.html'],
  ];

  for (const [srcName, destName] of files) {
    const src = join(pluginSrc, srcName);
    const dest = join(targetDir, destName);

    if (!existsSync(src)) {
      console.warn(`  ⚠️  Skipping ${srcName} (not found in ${pluginSrc})`);
      continue;
    }

    copyFileSync(src, dest);
  }

  // 复制 dist/code.js（Plugin 主线程 bundle）
  const codeJsSrc = join(pluginSrc, 'dist', 'code.js');
  const codeJsDest = join(targetDir, 'dist', 'code.js');
  if (existsSync(codeJsSrc)) {
    mkdirSync(join(targetDir, 'dist'), { recursive: true });
    copyFileSync(codeJsSrc, codeJsDest);
    console.log(`  ✅ Plugin files copied to: ${targetDir}`);
  } else {
    console.warn(`  ⚠️  dist/code.js not found — run plugin build first`);
  }
}

/** 配置 MCP */
export function configureMcp(projectDir?: string): string {
  const mcpConfig = {
    mcpServers: {
      'figma-forge': {
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
  console.log('  Figma Forge — Setup Complete!');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Next steps:');
  console.log('');
  console.log('  1. Install the Figma Plugin:');
  console.log('     - Open Figma Desktop (not Web version)');
  console.log('     - Plugins → Development → Import plugin from manifest');
  console.log(`     - Select: ${join(pluginDir, 'manifest.json')}`);
  console.log('');
  console.log('  2. Start Claude Code in your project directory:');
  console.log('     $ cd <your-project>');
  console.log('     $ claude');
  console.log('     Claude Code will auto-detect .mcp.json and start the Bridge.');
  console.log('     ⚠️  Do NOT start the Bridge manually — Claude Code manages it.');
  console.log('');
  console.log('  3. In Figma, run the Plugin:');
  console.log('     - Right-click → Plugins → Figma Forge');
  console.log('     - UI should show "Connected to Bridge"');
  console.log('');
  console.log('  4. Ask Claude Code to design:');
  console.log('     "帮我创建一个登录页面"');
  console.log('');
  console.log('  5. REST API (optional, requires Bridge running):');
  console.log('     curl http://localhost:37850/health');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
}

/** 运行 setup 流程 */
export function runSetup(options: SetupOptions = {}): void {
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const mcpConfigPath = options.mcpConfig || options.projectDir || process.cwd();

  console.log('');
  console.log('🔧 Figma Forge Setup');
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
