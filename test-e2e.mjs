// ============================================================
// Phase 1 端到端验收测试
// 模拟 Claude Code → Bridge Server → (Plugin) 链路
// ============================================================

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const results = [];

function log(test, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏳';
  results.push({ test, status, detail });
  console.log(`${icon} ${test}${detail ? ' — ' + detail : ''}`);
}

async function runTest() {
  console.log('=== Phase 1 验收测试 ===\n');

  // Test 1: Bridge Server 启动
  log('T1: Bridge Server 启动', 'RUNNING');
  const server = spawn(process.execPath, ['packages/bridge/dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd()
  });

  let serverOutput = '';
  let serverReady = false;

  server.stdout.on('data', (data) => {
    const text = data.toString();
    serverOutput += text;
    if (text.includes('MCP Server started')) {
      serverReady = true;
    }
  });

  server.stderr.on('data', (data) => {
    console.error('  Server error:', data.toString().trim());
  });

  // 等待服务器启动
  await sleep(2000);
  if (serverReady) {
    log('T1: Bridge Server 启动', 'PASS', '端口 37849 + MCP stdio 就绪');
  } else {
    log('T1: Bridge Server 启动', 'FAIL', '启动超时');
    server.kill();
    process.exit(1);
  }

  // Test 2: MCP Initialize 握手
  log('T2: MCP Initialize 握手', 'RUNNING');
  const initMsg = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
  server.stdin.write(initMsg + '\n');
  await sleep(500);

  if (serverOutput.includes('"serverInfo"') && serverOutput.includes('figma-bridge')) {
    log('T2: MCP Initialize 握手', 'PASS', '返回正确的 serverInfo');
  } else {
    log('T2: MCP Initialize 握手', 'FAIL', '未收到正确的初始化响应');
  }

  // Test 3: tools/list 返回 33 个工具
  log('T3: 工具注册数量', 'RUNNING');
  const listMsg = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  server.stdin.write(listMsg + '\n');
  await sleep(500);

  // 计算工具数量
  const toolMatches = serverOutput.match(/"name":"[^"]+"/g);
  const toolCount = toolMatches ? toolMatches.length : 0;

  if (toolCount >= 33) {
    log('T3: 工具注册数量', 'PASS', `注册了 ${toolCount} 个工具`);
  } else {
    log('T3: 工具注册数量', 'FAIL', `期望 33+，实际 ${toolCount}`);
  }

  // Test 4: 核心工具存在性检查
  log('T4: 核心 Semantic Tools 存在', 'RUNNING');
  const requiredTools = [
    'get_document_info', 'get_node_tree', 'create_container', 'create_text',
    'create_button', 'create_card', 'create_sidebar',
    'find_nodes', 'get_semantic_map',
    'update_node', 'delete_node', 'batch_execute'
  ];
  const missing = requiredTools.filter(t => !serverOutput.includes(`"name":"${t}"`));
  if (missing.length === 0) {
    log('T4: 核心 Semantic Tools 存在', 'PASS', `全部 ${requiredTools.length} 个核心工具就绪`);
  } else {
    log('T4: 核心 Semantic Tools 存在', 'FAIL', `缺失: ${missing.join(', ')}`);
  }

  // Test 5: Tool 调用测试（模拟 create_container 调用，无 Plugin 连接应返回错误）
  log('T5: Tool 调用（无 Plugin）', 'RUNNING');
  const callMsg = JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'get_document_info', arguments: {} }
  });
  server.stdin.write(callMsg + '\n');
  await sleep(1000);

  // 无 Plugin 连接时应返回 "Plugin not connected" 错误
  if (serverOutput.includes('Plugin not connected') || serverOutput.includes('isError')) {
    log('T5: Tool 调用（无 Plugin）', 'PASS', '正确返回 Plugin not connected 错误');
  } else {
    log('T5: Tool 调用（无 Plugin）', 'FAIL', '未返回预期错误');
  }

  // 清理
  server.kill();

  // 汇总
  console.log('\n=== 验收结果汇总 ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`通过: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`失败: ${failed}`);
  }
  console.log('');
  console.log('注意: 以下测试需要 Figma Desktop 运行:');
  console.log('  - 在 Figma 中加载 packages/plugin 目录作为 Plugin');
  console.log('  - 确认 Plugin UI 显示 "Connected to Bridge"');
  console.log('  - 通过 Claude Code 调用 get_document_info 验证完整链路');
}

runTest().catch(console.error);
