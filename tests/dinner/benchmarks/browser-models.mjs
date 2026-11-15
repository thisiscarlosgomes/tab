import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = '/tmp/tab-model-browser-benchmark';
await mkdir(directory, { recursive: true });
const results = [];
for (const model of ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5.4-nano', 'gpt-5.4-mini']) {
  const started = performance.now();
  let output = '';
  const code = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--env-file=.env.local', '--import', 'tsx', '--import', './tests/dinner/benchmarks/capture.ts', 'tests/dinner/lookup-browser.ts'], { env: { ...process.env, OPENAI_CHAT_MODEL: model, TAB_BENCH_TELEMETRY_FILE: `${directory}/${model}-usage.json` } });
    p.stdout.on('data', x => output += x); p.stderr.on('data', x => output += x);
    p.on('error', reject); p.on('exit', resolve);
  });
  await writeFile(`${directory}/${model}.log`, output);
  results.push({ model, pass: code === 0, exitCode: code, milliseconds: Math.round(performance.now() - started), output });
  await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${model} browser lookup/deletion journey`);
}
