"""Launch/reuse an isolated instance of the installed, unmodified workbench."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--doctor', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    state = Path(args.state).resolve()
    if not (root / 'workbench.py').is_file():
        raise ValueError('workbench.py not found')

    # Reuse only acceleration/model settings, never the old project store,
    # private method library, sessions, or an unrelated running service.
    if os.name == 'nt':
        old_state = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'SelfMediaWorkbench'
    elif sys.platform == 'darwin':
        old_state = Path.home() / 'Library/Application Support/SelfMediaWorkbench'
    else:
        old_state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'self-media-workbench'
    old_file = old_state / 'config.json'
    old = json.loads(old_file.read_text('utf-8')) if old_file.is_file() else {}
    names = {'model': 'SELF_MEDIA_MODEL', 'mlx_model': 'SELF_MEDIA_MLX_MODEL',
             'asr_backend': 'SELF_MEDIA_ASR_BACKEND', 'device': 'SELF_MEDIA_DEVICE',
             'language': 'SELF_MEDIA_LANGUAGE', 'cpp_executable': 'SELF_MEDIA_CPP_EXECUTABLE',
             'cpp_model': 'SELF_MEDIA_CPP_MODEL', 'cpp_gpu_index': 'SELF_MEDIA_CPP_GPU_INDEX',
             'require_gpu': 'SELF_MEDIA_REQUIRE_GPU', 'cuda_dll_dirs': 'SELF_MEDIA_CUDA_DLL_DIRS'}
    for name, env in names.items():
        if name in old and env not in os.environ:
            value = old[name]
            os.environ[env] = os.pathsep.join(value) if isinstance(value, list) else str(value)
    os.environ['SELF_MEDIA_STATE_DIR'] = str(state)
    os.environ['SELF_MEDIA_DATA_DIR'] = str(state / 'projects')
    os.environ.pop('SELF_MEDIA_LIBRARY', None)
    os.environ.pop('SELF_MEDIA_SKILL_ROOT', None)
    sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location('self_media_workbench_entry', root / 'workbench.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if args.doctor:
        output = module.doctor()
    else:
        base = module.ensure_service()
        output = {'base_url': base, 'status': module.request(base, 'GET', '/api/status')}
    print(json.dumps(output, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
