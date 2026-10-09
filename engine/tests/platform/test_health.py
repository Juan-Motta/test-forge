from httpx import ASGITransport, AsyncClient

from voice_eval.platform.app import create_app
from voice_eval.platform.settings import Settings


async def test_health_ok_with_database(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_reports_unavailable_database():
    settings = Settings(_env_file=None, database_url="postgresql+asyncpg://u:p@127.0.0.1:9/nowhere")
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.get("/api/health")
    await app.state.engine.dispose()
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "nowhere" not in response.text


async def test_cors_allows_only_configured_origins(client):
    allowed = await client.options(
        "/api/auth/login",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert allowed.headers["access-control-allow-credentials"] == "true"
    denied = await client.options(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in denied.headers
