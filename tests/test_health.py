import asyncio

import httpx

from backend.app import app


def test_health_reports_backend_liveness_only():
    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.get("/health")

    response = asyncio.run(request())
    assert response.status_code == 200
    assert response.json() == {'status': 'ok', 'service': 'task-manager'}
