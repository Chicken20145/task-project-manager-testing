from datetime import datetime, timezone
import sqlite3

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from .api import router
from .auth import AuthLimiter
from .db import ROOT
from .http_security import BrowserBoundary, SECURITY_HEADERS
from .repository import DataError
from .settings import Settings


def create_app(settings=None, *, clock=None):
    settings = settings or Settings.from_environment()
    app = FastAPI(title='Task and Project Manager', version='0.2.0', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.clock = clock or (lambda: datetime.now(timezone.utc))
    app.state.auth_limiter = AuthLimiter()
    app.add_middleware(BrowserBoundary, settings=settings)

    def error_response(status, code, message, details=None):
        return JSONResponse({'error': {'code': code, 'message': message, 'details': details or {}}}, status_code=status,
                            headers={'Retry-After': '60'} if status == 429 else None)

    @app.exception_handler(DataError)
    async def data_error(request, error):
        return error_response(error.status, error.code, str(error), error.error['details'])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        details = {str(item['loc'][1]): 'Dữ liệu chưa hợp lệ.' for item in error.errors() if len(item['loc']) > 1}
        return error_response(422, 'VALIDATION_ERROR', 'Dữ liệu chưa hợp lệ.', details)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return error_response(error.status_code, 'NOT_FOUND' if error.status_code == 404 else 'HTTP_ERROR',
                              'Không tìm thấy tài nguyên.' if error.status_code == 404 else 'Yêu cầu không được hỗ trợ.')

    @app.exception_handler(sqlite3.Error)
    @app.exception_handler(FileNotFoundError)
    async def database_error(request, error):
        status = 503 if isinstance(error, (sqlite3.OperationalError, FileNotFoundError)) else 500
        return error_response(status, 'DATABASE_UNAVAILABLE' if status == 503 else 'INTERNAL_ERROR',
                              'Cơ sở dữ liệu chưa sẵn sàng. Hãy thử lại.' if status == 503 else 'Không xử lý được yêu cầu.')

    @app.exception_handler(Exception)
    async def internal_error(request, error):
        response = error_response(500, 'INTERNAL_ERROR', 'Không xử lý được yêu cầu.')
        # Starlette handles unexpected exceptions outside user middleware.
        response.headers.update(SECURITY_HEADERS | {'cache-control': 'no-store'})
        if settings.cookie_secure:
            response.headers['strict-transport-security'] = 'max-age=31536000'
        return response

    @app.get('/health')
    def health():
        return {'status': 'ok', 'service': 'task-manager'}

    @app.get('/api/meta')
    def metadata():
        return {'edition': settings.edition, 'build_id': settings.build_id, 'ai_enabled': False}

    app.include_router(router)
    app.mount('/', StaticFiles(directory=ROOT / 'web', html=True), name='web')
    return app


app = create_app()
