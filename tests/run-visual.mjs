/**
 * 视觉验收统一入口
 *
 * 依次运行三套视觉工作流 + 喷口物理语义断言, 汇总结果。
 * 每一套都独立启动临时 http 服务(自动选空闲端口), 结束自动关闭。
 *
 * 用法:
 *   node tests/run-visual.mjs          # 全跑
 *   node tests/run-visual.mjs --only gallery
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

const SUITES = [
  { name: 'gallery',  desc: '车型七视角 (独立模型展厅)',       file: 'gallery-shots.mjs' },
  { name: 'frames',   desc: '固定诊断机位关键帧',               file: 'visual-reference.mjs' },
  { name: 'compare',  desc: '原视频 vs 渲染 并排对照图',         file: 'side-by-side.mjs' },
  { name: 'nozzles',  desc: '喷口物理语义断言 (读取实际姿态)',  file: 'nozzles.test.mjs' },
];

const run = (file) => new Promise(res => {
  const p = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  p.on('close', code => res(code ?? 1));
});

const results = [];
for (const s of SUITES) {
  if (only && s.name !== only) { results.push({ ...s, code: null, skipped: true }); continue; }
  console.log('\n' + '━'.repeat(58));
  console.log(`▶ ${s.name}: ${s.desc}`);
  console.log('━'.repeat(58));
  const code = await run(s.file);
  results.push({ ...s, code, skipped: false });
}

console.log('\n' + '═'.repeat(58));
console.log('  视觉验收汇总');
console.log('═'.repeat(58));
for (const r of results) {
  const st = r.skipped ? 'SKIP' : (r.code === 0 ? ' PASS' : ` FAIL(${r.code})`);
  console.log(`  ${r.name.padEnd(9)} ${st.padEnd(10)} ${r.desc}`);
}
console.log('═'.repeat(58));
const failed = results.filter(r => !r.skipped && r.code !== 0);
if (failed.length) {
  console.log(`\n⚠️  ${failed.length} 套视觉工作流失败 —— 截图生成成功只代表流程通, 不代表视觉还原正确。`);
  console.log('   请人工检查 ref/compare/ 的并排图: 车型轮廓 / 倒挂姿态 / 光束数量与方向 / 缓降时序 / 触地蒸汽云。');
  process.exit(1);
}
console.log('\n✅ 三套视觉工作流流程通过。');
console.log('   ⚠️ 仍需人工验收: ref/compare/ 的并排图(车型轮廓/倒挂姿态/光束方向/缓降时序/触地蒸汽云)');
console.log('      以及 ref/car-views/ 的七视角(前/后/侧/前45/后45/顶/底)。');
process.exit(0);
