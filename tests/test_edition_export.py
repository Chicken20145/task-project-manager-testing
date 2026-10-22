from pathlib import Path
import json

import pytest

from scripts.create_editions import COMMON_FILES, export_edition


@pytest.fixture
def source(tmp_path):
    root = tmp_path / 'source'
    for relative in COMMON_FILES + ('config/ai.env.example', 'models/Modelfile'):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('safe fixture', encoding='utf-8')
    for relative in ('.env', 'config/web.env', 'data/task-manager.db', '.git/config', 'instructor-materials/answers.md', 'backend/unapproved.py'):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('DO NOT COPY', encoding='utf-8')
    return root


def test_export_has_allowlist_identity_config_manifest_and_no_private_data(source, tmp_path):
    destination = tmp_path / 'testing'
    export_edition(source, destination, 'testing', 8003, 'baseline-20261019')
    assert json.loads((destination / 'edition.json').read_text()) == {'edition': 'testing', 'build_id': 'baseline-20261019'}
    assert 'APP_EDITION=testing' in (destination / 'config/web.env.example').read_text()
    assert '8003' in (destination / 'config/web.env.example').read_text()
    assert '8003' in (destination / 'README.md').read_text(encoding='utf-8')
    assert not any(path.read_bytes() == b'DO NOT COPY' for path in destination.rglob('*') if path.is_file())
    assert not (destination / 'models').exists() and not (destination / 'config/ai.env.example').exists()
    assert not (destination / 'data').exists() and not (destination / '.git').exists()
    manifest = json.loads((destination / 'SOURCE-MANIFEST.json').read_text())
    from hashlib import sha256
    for item in manifest['files']:
        assert sha256((destination / item['path']).read_bytes()).hexdigest() == item['sha256']
    with pytest.raises(FileExistsError):
        export_edition(source, destination, 'testing', 8003, 'baseline-20261019')


def test_ai_alone_includes_model_template_and_ai_config(source, tmp_path):
    destination = tmp_path / 'ai'
    export_edition(source, destination, 'ai', 8002, 'baseline-20261019')
    assert (destination / 'models/Modelfile').is_file()
    assert (destination / 'config/ai.env.example').is_file()
    assert 'APP_EDITION=ai' in (destination / 'config/web.env.example').read_text()


def test_missing_source_or_alias_fails_before_creating_output(source, tmp_path, monkeypatch):
    missing = source / COMMON_FILES[0]
    missing.unlink()
    output = tmp_path / 'output'
    with pytest.raises(FileNotFoundError):
        export_edition(source, output, 'ai', 8002, 'baseline-20261019')
    assert not output.exists()
    missing.write_text('fixture')
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == missing or original(path))
    with pytest.raises(ValueError):
        export_edition(source, output, 'ai', 8002, 'baseline-20261019')
    assert not output.exists()


def test_invalid_identity_or_nested_source_target_never_writes(source, tmp_path):
    for edition, port, build in [('baseline', 8002, 'b'), ('ai', 0, 'b'), ('ai', 8002, '../bad')]:
        with pytest.raises(ValueError):
            export_edition(source, tmp_path / 'absent', edition, port, build)
    with pytest.raises(ValueError):
        export_edition(source, source / 'backend/new', 'ai', 8002, 'b')
    assert not (source / 'backend/new').exists()
