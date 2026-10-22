"""Run only this checkout on loopback, using its web config. Never seed/reset/start Ollama."""
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

if __name__ == '__main__':
    from dotenv import load_dotenv
    import uvicorn
    from backend.settings import Settings

    config = ROOT / 'config' / 'web.env'
    load_dotenv(config if config.is_file() else ROOT / 'config' / 'web.env.example', override=True)
    settings = Settings.from_environment()
    origin = urlsplit(settings.public_origin)
    host, port = os.getenv('WEB_HOST', '127.0.0.1'), int(os.getenv('WEB_PORT', '8000'))
    if (settings.environment != 'development' or settings.cookie_secure or origin.scheme != 'http'
            or host not in ('127.0.0.1', 'localhost', '::1') or host != origin.hostname or origin.port != port):
        raise SystemExit('Local launcher requires matching loopback HTTP host/port/PUBLIC_ORIGIN.')
    uvicorn.run('backend.app:app', host=host, port=port, proxy_headers=False)
