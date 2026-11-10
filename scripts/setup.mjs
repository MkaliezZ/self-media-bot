import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.resolve(process.env.SELF_MEDIA_BOT_HOME ?? path.join(root, '.local'));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 9)) throw new Error('需要 Node.js 24.9 或更新版本。');
fs.mkdirSync(home, { recursive: true, mode: 0o700 });
const read = (file, fallback = {}) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const settingsPath = path.join(home, 'settings.json'); const saved = read(settingsPath);
const location = read(path.join(os.homedir(), '.codex', 'skills', 'media-workbench', 'location.json'));
let workbenchRoot = process.env.SELF_MEDIA_WORKBENCH_ROOT || saved.workbenchRoot || location.root;
let python = process.env.SELF_MEDIA_WORKBENCH_PYTHON || saved.python || location.python || (process.platform === 'win32' ? 'python' : 'python3');
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`安装步骤未完成：${path.basename(command)}。${result.error?.message ?? (capture ? result.stderr : '')}`);
  return result.stdout?.trim() ?? '';
}
const version = JSON.parse(run(python, ['-c', 'import json,sys; print(json.dumps(list(sys.version_info[:2])))'], root, true));
if (version[0] < 3 || (version[0] === 3 && version[1] < 11)) throw new Error('自媒体工作台需要 Python 3.11 或更新版本。');
if (workbenchRoot && fs.existsSync(path.join(workbenchRoot, 'workbench.py'))) {
  console.log('复用已安装的自媒体工作台；不会修改原源码、解释器或项目库。');
  run(python, ['-X', 'utf8', '-c', 'import fastapi, uvicorn, pydantic, numpy, PIL; print("工作台基础依赖可用")']);
} else {
  const manifest = read(path.join(root, 'workbench.manifest.json'));
  workbenchRoot = path.join(home, 'dependencies', 'self-media-workbench');
  if (!fs.existsSync(workbenchRoot)) {
    console.log('将从公开仓库安装固定版本的工作台到本 Bot 的私有目录。不会安装或下载 ASR 模型。');
    fs.mkdirSync(path.dirname(workbenchRoot), { recursive: true });
    run('git', ['clone', '--filter=blob:none', '--no-checkout', manifest.repository, workbenchRoot]);
    run('git', ['checkout', '--detach', manifest.commit], workbenchRoot);
  } else if (!fs.existsSync(path.join(workbenchRoot, 'workbench.py'))) {
    throw new Error('依赖目标目录已存在但不是完整工作台。为保护现有文件，本程序不会覆盖；请换一个私有数据目录。');
  }
  const venv = path.join(home, 'workbench-venv');
  const targetPython = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(targetPython)) run(python, ['-m', 'venv', venv]);
  python = targetPython;
  run(python, ['-m', 'pip', 'install', '-r', path.join(workbenchRoot, 'requirements.txt')]);
  if (process.argv.includes('--with-asr')) run(python, ['-m', 'pip', 'install', '-r', path.join(workbenchRoot, 'requirements-asr.txt')]);
}
const next = { ...saved, workbenchRoot: path.resolve(workbenchRoot), python };
const temp = `${settingsPath}.setup.tmp`; fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, settingsPath);
console.log('基础配置已保存。模型 Key 请在界面设置中填写，或使用 DEEPSEEK_API_KEY 环境变量。');
console.log('文本与布光不需要 ASR；剪辑需要 FFmpeg，转写还需要兼容的本地 ASR 模型。');
console.log('继续运行 npm run build，然后 npm start；Windows 也可以双击 start.cmd。');
