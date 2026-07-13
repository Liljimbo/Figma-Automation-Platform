// ============================================================
// @figma-bridge/bridge — CLI 入口
// Usage: figma-bridge [setup] [--plugin-dir <path>] [--project-dir <path>]
// ============================================================

import { runSetup } from './setup.js';

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log('');
  console.log('Usage: figma-bridge [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  setup     Install Plugin files and configure MCP');
  console.log('  (none)    Start the Bridge Server');
  console.log('');
  console.log('Setup options:');
  console.log('  --plugin-dir <path>   Where to install Plugin files (default: ~/.figma-bridge/plugin)');
  console.log('  --project-dir <path>  Where to write .mcp.json (default: current directory)');
  console.log('');
  console.log('Examples:');
  console.log('  figma-bridge setup');
  console.log('  figma-bridge setup --plugin-dir ./my-plugin');
  console.log('  figma-bridge setup --project-dir ~/my-project');
  console.log('');
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

if (command === 'setup') {
  runSetup({
    pluginDir: getArg('--plugin-dir'),
    projectDir: getArg('--project-dir'),
  });
} else if (command === '--help' || command === '-h') {
  printUsage();
} else if (command === undefined) {
  // 没有参数：启动 Bridge Server（通过子进程调用 index.js）
  const { execFileSync } = await import('child_process');
  const { resolve } = await import('path');
  const indexPath = resolve(import.meta.dirname || __dirname, 'index.js');
  execFileSync(process.execPath, [indexPath], { stdio: 'inherit' });
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
