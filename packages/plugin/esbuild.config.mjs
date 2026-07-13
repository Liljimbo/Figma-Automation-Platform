// ============================================================
// esbuild 配置 — 将 Plugin 代码打包为单文件
// Figma Plugin 不支持 ES modules，需要打包为单个 IIFE
// ============================================================

import { build } from 'esbuild';
import { copyFileSync, existsSync } from 'fs';

await build({
  entryPoints: ['src/code.ts'],
  bundle: true,        // 打包所有依赖
  format: 'iife',      // 立即执行函数，兼容 Figma 沙箱
  outfile: 'dist/code.js',
  target: 'es2022',
  platform: 'browser', // Figma 沙箱是浏览器环境
  sourcemap: false,    // Figma Plugin 不支持 source map
  minify: false,       // 保持可读性，便于调试
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // 忽略 node_modules 中的仅类型导入
  external: [],
}).then(() => {
  console.log('✅ Plugin bundled: dist/code.js');

  // 将 ui.html 复制到 plugin 根目录（供 Figma Import from manifest 使用）
  const uiSrc = 'src/ui.html';
  const uiDest = 'ui.html';
  if (existsSync(uiSrc)) {
    copyFileSync(uiSrc, uiDest);
    console.log('✅ Copied ui.html to plugin root');
  }
}).catch((err) => {
  console.error('❌ Bundle failed:', err);
  process.exit(1);
});
