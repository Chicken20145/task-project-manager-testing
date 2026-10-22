"""One-time, allowlisted source export. Never copies a database, private env, Git or answers."""
from hashlib import sha256
import json
from pathlib import Path
import re
from shutil import copyfile


COMMON_FILES = tuple(
    ['backend/' + name for name in '''__init__.py api.py app.py auth.py db.py http_security.py passwords.py
        queries.py repository.py schema.sql seed_data.py seed.py settings.py'''.split()]
    + ['web/' + name for name in 'index.html app.js routes.js styles.css views.js edition.js'.split()]
    + ['web/data/' + name for name in 'client.js fixtures.js http.js mock.js queries.js validators.js'.split()]
    + ['web/assets/' + name for name in 'inter-latin.woff2 inter-vietnamese.woff2 Inter-OFL.txt'.split()]
    + ['tests/' + name for name in '''controller.test.mjs edition.test.mjs http-client.test.mjs mock-client.test.mjs
        project-search.test.mjs queries.test.mjs registration.test.mjs routes.test.mjs validators.test.mjs views.test.mjs
        test_auth_api.py test_business_api.py test_editions.py test_edition_export.py test_health.py
        test_read_queries.py test_schema.py test_seed_data.py test_seed.py test_transactions.py'''.split()]
    + ['scripts/create_editions.py', 'scripts/run_local.py', '.gitignore', 'requirements.txt', 'requirements-lock.txt',
       'docs/backend-boundaries.md', 'tasks/contracts.md', 'reports/seed-guide.md']
)


def export_edition(source, destination, edition, port, build_id):
    source, destination = Path(source).absolute(), Path(destination).absolute()
    if edition not in ('ai', 'testing') or type(port) is not int or not 1024 <= port <= 65535 or not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', build_id):
        raise ValueError('Invalid edition, port or build identity.')
    if destination.exists() or destination.is_symlink() or destination.is_junction():
        raise FileExistsError('Edition output exists; will not overwrite it.')
    if source.resolve() != source or destination.resolve() != destination:
        raise ValueError('Export paths cannot traverse aliases.')
    if destination.is_relative_to(source) and destination.parent != source / 'editions':
        raise ValueError('Nested exports must be directly inside source/editions.')
    files = COMMON_FILES + (('config/ai.env.example', 'models/Modelfile') if edition == 'ai' else ())
    # Validate every file before creating output. No recursive glob can add private/unapproved files.
    for name in files:
        path = source / name
        if path.is_symlink() or path.resolve() != path or path.is_junction():
            raise ValueError('Source allowlist cannot contain aliases.')
        if not path.is_file():
            raise FileNotFoundError(name)
    destination.mkdir(parents=True, exist_ok=False)
    for name in files:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copyfile(source / name, target)
    (destination / 'edition.json').write_text(json.dumps({'edition': edition, 'build_id': build_id}, indent=2) + '\n', encoding='utf-8')
    config = f'''# Local configuration for this source checkout; no credentials.
APP_EDITION={edition}
PUBLIC_ORIGIN=http://127.0.0.1:{port}
WEB_HOST=127.0.0.1
WEB_PORT={port}
DATABASE_PATH=data/task-manager.db
APP_TIMEZONE=Asia/Ho_Chi_Minh
APP_ENV=development
COOKIE_SECURE=false
'''
    (destination / 'config').mkdir(exist_ok=True)
    (destination / 'config/web.env.example').write_text(config, encoding='utf-8')
    title = 'Bản dành cho môn AI' if edition == 'ai' else 'Bản kiểm thử không AI'
    (destination / 'README.md').write_text(f'''# {title}

Build `{build_id}`. Source/database/config/session riêng, từ baseline đúng đã nghiệm thu.
Hiện chỉ có nghiệp vụ web; {'AI chưa tích hợp.' if edition == 'ai' else 'Chưa cài lỗi bài tập; không cần Ollama.'}

## Chạy local

Trong thư mục bản này: `./start.ps1`. Launcher ưu tiên .venv của bản này; ở layout editions/ hiện tại có thể dùng .venv chung bên ngoài để tiết kiệm dung lượng.
Hoặc dùng Python đã cài requirements: `python scripts/run_local.py`.
Mở http://127.0.0.1:{port}/ . Config mặc định: config/web.env.example; nếu config/web.env có sẵn thì dùng file đó, không ghi đè.

Máy mới: tạo .venv, cài requirements-lock.txt (Windows/Python3.13), chạy `python -m backend.db` rồi `python -m backend.seed --profile demo` chỉ khi DB rỗng. Không seed/reset khi startup.
DB riêng: data/task-manager.db. Mật khẩu mẫu local demo123; users nguyen.van.a (owner project10), tran.thi.b (member), le.van.c (outsider).

## Kiểm chứng

`python -m pytest tests -q` và `node --test tests/*.test.mjs`.
Cookie riêng: task_manager_{edition}_session. Không trỏ DATABASE_PATH sang bản khác; không copy data hoặc env thật. Reset chỉ bằng CLI của source này và đường dẫn xác nhận chính xác, khi không có người đang test.
Schema không tự migrate/reset. Nghiệp vụ đúng: tasks/contracts.md. Git chưa có commit/push. SOURCE-MANIFEST.json ghi hash source lúc tách, không chứa DB/session.

Đây là local development. Public sau này cần hostnameHTTPS riêng và cấu hình production. README không chứa đáp án lỗi; chưa phải link bàn giao public cho môn học.
''', encoding='utf-8')
    (destination / 'start.ps1').write_text('''$ErrorActionPreference = 'Stop'
$editionRoot = $PSScriptRoot
$editionPython = Join-Path $editionRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $editionPython)) {
    $editionPython = Join-Path (Split-Path (Split-Path $editionRoot -Parent) -Parent) '.venv/Scripts/python.exe'
}
if (-not (Test-Path -LiteralPath $editionPython)) { throw 'Create a local .venv or run python scripts/run_local.py with dependencies installed.' }
& $editionPython (Join-Path $editionRoot 'scripts/run_local.py')
exit $LASTEXITCODE
''', encoding='utf-8')
    entries = []
    for path in sorted(destination.rglob('*')):
        if path.is_file():
            entries.append({'path': path.relative_to(destination).as_posix(), 'sha256': sha256(path.read_bytes()).hexdigest()})
    manifest = {'edition': edition, 'build_id': build_id, 'files': entries}
    (destination / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    # No overwrite/reset/cleanup mode: keep every existing checkout intact.
    for edition in ('ai', 'testing'):
        destination = root / 'editions' / ('task-project-manager-' + edition)
        if destination.exists() or destination.is_symlink() or destination.is_junction():
            raise SystemExit('An edition output already exists. Existing sources were preserved.')
    for edition, port in (('ai', 8002), ('testing', 8003)):
        result = export_edition(root, root / 'editions' / ('task-project-manager-' + edition), edition, port, 'baseline-20261019')
        print(f"Exported {edition}: {len(result['files'])} source files; database not copied.")
