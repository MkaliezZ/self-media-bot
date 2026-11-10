import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Config } from '../server/config.js';
import { testModel } from '../server/runtime.js';
import { modelServer } from '../tests/fixtures/model-server.js';

const temp = path.join(os.tmpdir(), 'opencode'); await mkdir(temp, { recursive: true });
const home = await mkdtemp(path.join(temp, 'self-media-bot-runtime-'));
const fixture = await modelServer(() => ({ text: '连接成功（协议测试夹具，非真实模型）' }));
try {
  const config = new Config(home); await config.init();
  await config.save({ apiKey: `sk-${'0'.repeat(32)}`, baseUrl: fixture.url, model: 'deepseek-flash', maxTokens: 2048, vision: false,
    workbenchRoot: config.public().workbenchRoot, python: config.public().python });
  const result = await testModel(config, process.cwd());
  console.log(JSON.stringify({ ...result, note: '使用本机协议夹具通过官方 DSH 完成真实协议往返；未调用外部模型、未产生模型费用。', testFixture: true, home, requests: fixture.requests.length, tools: fixture.requests[0]?.tools?.map((t: any) => t.name) ?? [] }, null, 2));
} finally { await fixture.close(); }
