"""Same-origin browser boundary, bounded JSON bodies, and response headers."""
import asyncio
import json
from urllib.parse import urlsplit

from starlette.middleware.trustedhost import TrustedHostMiddleware

BODY_TIMEOUT_SECONDS = 10


SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}


class BrowserBoundary:
    def __init__(self, app, settings):
        self.app, self.settings = app, settings
        if settings.environment == 'production':
            self.app = TrustedHostMiddleware(app, allowed_hosts=[urlsplit(settings.public_origin).hostname],
                                             www_redirect=False)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        api = scope['path'].startswith('/api/') or scope['path'] == '/api'
        headers = {key.decode('latin1'): value.decode('latin1') for key, value in scope['headers']}

        async def secured_send(message):
            if message['type'] == 'http.response.start':
                extra = [(key.encode(), value.encode()) for key, value in SECURITY_HEADERS.items()]
                extra.append((b'cache-control', b'no-store' if api else b'no-cache'))
                if self.settings.cookie_secure:
                    extra.append((b'strict-transport-security', b'max-age=31536000'))
                message['headers'] = list(message.get('headers', [])) + extra
            await send(message)

        async def reject(status, code, message):
            body = json.dumps({'error': {'code': code, 'message': message, 'details': {}}}).encode()
            await secured_send({'type': 'http.response.start', 'status': status,
                                'headers': [(b'content-type', b'application/json'), (b'content-length', str(len(body)).encode())]})
            await secured_send({'type': 'http.response.body', 'body': body})

        if api and scope['method'] not in ('GET', 'HEAD', 'OPTIONS'):
            if (headers.get('x-requested-with') != 'TaskManager'
                    or headers.get('sec-fetch-site') == 'cross-site'
                    or ('origin' in headers and headers['origin'] != self.settings.public_origin)):
                return await reject(403, 'ORIGIN_REJECTED', 'Yêu cầu phải đến từ website của ứng dụng.')
            # DELETE without a body still uses the custom header and authenticated CSRF.
            no_body = scope['method'] == 'DELETE' or scope['path'] == '/api/auth/logout'
            if not no_body and headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
                return await reject(415, 'UNSUPPORTED_MEDIA_TYPE', 'Yêu cầu cần dữ liệu JSON.')
            body = bytearray()
            try:
                async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
                    while True:
                        message = await receive()
                        if message['type'] == 'http.disconnect':
                            return
                        body.extend(message.get('body', b''))
                        if len(body) > 16 * 1024:
                            break
                        if not message.get('more_body', False):
                            break
            except TimeoutError:
                return await reject(408, 'BODY_TIMEOUT', 'Quá thời gian nhận dữ liệu. Hãy thử lại.')
            if len(body) > 16 * 1024:
                return await reject(413, 'BODY_TOO_LARGE', 'Dữ liệu gửi lên vượt giới hạn 16 KiB.')
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                return await receive()

            return await self.app(scope, replay, secured_send)
        return await self.app(scope, receive, secured_send)
