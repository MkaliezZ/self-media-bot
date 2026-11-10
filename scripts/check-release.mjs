import fs from 'node:fs';
import path from 'node:path';

const roots = ['server', 'shared', 'runtime', 'skills', 'web', 'scripts', 'tests', 'docs', '.github'];
const files = ['README.md', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'workbench.manifest.json', 'vite.config.ts', 'playwright.config.ts', 'tsconfig.json', 'tsconfig.server.json', 'vitest.config.ts', '.env.example', '.gitignore', '.npmrc', 'start.cmd', 'start.sh'];
function walk(dir) { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '__pycache__', '.local', '.git'].includes(entry.name)) continue; const file = path.join(dir, entry.name); entry.isDirectory() ? walk(file) : files.push(file); } }
roots.forEach(walk);
const patterns = [
  ['API key literal', /sk-[A-Za-z0-9_-]{20,}/g],
  ['GitHub token literal', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['npm token literal', /npm_[A-Za-z0-9]{30,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['developer-specific private path', /(?:F:\\(?:Codex|Opencode) Workspace|C:\\Users\\Administrator)/g],
];
const findings = [];
for (const file of files) {
  if (!fs.existsSync(file) || (!/\.(ts|tsx|mjs|py|json|md|txt|html|css|ya?ml|cmd|sh)$/.test(file) && !['LICENSE', '.gitignore', '.env.example', '.npmrc'].includes(path.basename(file)))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of patterns) for (const match of text.matchAll(pattern)) findings.push({ file, issue: label, line: text.slice(0, match.index).split('\n').length });
}
// Never print a matched credential, even if the check fails.
console.log(JSON.stringify({ scannedSourceFiles: files.length, findings, privateDirectoriesExcluded: ['.local', 'node_modules', 'ui-design', 'test-results', 'release'] }, null, 2));
if (findings.length) process.exitCode = 1;
