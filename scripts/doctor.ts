import { Config } from '../server/config.js';
import { Workbench } from '../server/workbench.js';
import { createRequire } from 'node:module';

const config = new Config(); await config.init(); const s = config.public();
const require = createRequire(import.meta.url);
const dsh = require('@deepseek-ai/dsh/package.json');
const wb = new Workbench(config, process.cwd());
console.log(JSON.stringify({ node: process.version, dsh: dsh.version, model: s.model, credentialConfigured: s.hasKey, credentialSource: s.keySource, workbenchConfigured: !!s.workbenchRoot, workbench: await wb.doctor().then(d => ({ baseDependencies: d.dependencies, ffmpeg: !!d.executables.ffmpeg, ffprobe: !!d.executables.ffprobe, asrModelPresent: d.model_present, asrBackend: d.asr_backend, gpu: d.gpu_hardware, note: '硬件与依赖检测不是本轮转写或 GPU 推理验收。' })).catch(e => ({ error: e.message })) }, null, 2));
