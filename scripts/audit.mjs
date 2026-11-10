import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
const cli = candidates.find(file => fs.existsSync(file));
if (!cli) throw new Error('请通过 npm run audit:prod 运行本检查。');
const result = spawnSync(process.execPath, [cli, 'audit', '--omit=dev', '--registry=https://registry.npmjs.org', '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
let data;
try { data = JSON.parse(result.stdout); }
catch { console.error('无法获得依赖审计结果，不能将它当作“没有漏洞”。'); process.exit(2); }
const folder = path.join(process.env.SELF_MEDIA_BOT_HOME ?? '.local', 'verification'); fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'npm-audit.json'), JSON.stringify(data, null, 2));
const roots = Object.values(data.vulnerabilities ?? {}).filter(v => v.via.some(item => typeof item === 'object')).map(v => ({ package: v.name, severity: v.severity, advisories: v.via.filter(item => typeof item === 'object').map(item => ({ title: item.title, url: item.url, range: item.range })) }));
console.log(JSON.stringify({ vulnerabilities: data.metadata?.vulnerabilities ?? null, rootAdvisories: roots, registryError: data.error ?? null }, null, 2));
process.exitCode = data.error || (data.metadata?.vulnerabilities?.total ?? 0) > 0 ? 1 : 0;
