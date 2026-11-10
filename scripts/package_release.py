"""Package allowlisted source/build files, never local data or credentials."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
allowed = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'package.json',
           'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
           'vitest.config.ts', 'playwright.config.ts', 'workbench.manifest.json',
           '.gitignore', '.env.example', '.npmrc', 'start.cmd', 'start.sh', 'server', 'shared',
           'runtime', 'skills', 'web', 'dist', 'scripts', 'tests', 'docs', '.github']
files = []
for name in allowed:
    item = root / name
    if not item.exists():
        continue
    candidates = item.rglob('*') if item.is_dir() else [item]
    for file in candidates:
        if file.is_file() and not any(p in ('__pycache__', 'node_modules', '.local', '.git') for p in file.relative_to(root).parts):
            files.append(file)
manifest = []
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        relative = file.relative_to(root).as_posix()
        data = file.read_bytes()
        manifest.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        archive.writestr('self-media-bot/' + relative, data)
    archive.writestr('self-media-bot/SOURCE-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({'file': str(target), 'files': len(files), 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))
