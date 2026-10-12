import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from voice_eval.platform.app import create_app
from voice_eval.platform.settings import Settings

KEY = Fernet.generate_key().decode()


async def test_health_ok_with_database(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_reports_unavailable_database():
    settings = Settings(
        _env_file=None,
        database_url="postgresql+asyncpg://u:p@127.0.0.1:9/nowhere",
        voice_eval_master_key=KEY,
    )
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


@pytest.mark.parametrize("environment", [None, "production", "development"])
async def test_api_docs_are_public_in_every_environment(environment, monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)  # the unset case must not see the shell's
    overrides = {"environment": environment} if environment else {}
    settings = Settings(
        _env_file=None,
        database_url="postgresql+asyncpg://u:p@db/x",
        voice_eval_master_key=KEY,
        **overrides,
    )
    app = create_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://t") as client:
        docs = await client.get("/api/docs")
        schema = await client.get("/api/openapi.json")
        old = await client.get("/docs")
    await app.state.engine.dispose()
    # Under /api so the edge proxy reaches them; no credentials needed to read them.
    assert docs.status_code == schema.status_code == 200
    assert "swagger" in docs.text.lower()
    assert old.status_code == 404
    spec = schema.json()
    # Swagger's "Authorize" takes an API key (or session token) as a Bearer token...
    assert spec["components"]["securitySchemes"]["bearer"] == {
        "type": "http",
        "scheme": "bearer",
        "description": "An API key (`ve_…`) or a session token.",
    }
    assert spec["security"] == [{"bearer": []}]
    # ...while the public operations say they need none.
    assert spec["paths"]["/api/health"]["get"]["security"] == []
    assert spec["paths"]["/api/auth/login"]["post"]["security"] == []
    assert spec["paths"]["/api/skill"]["get"]["security"] == []
    assert "security" not in spec["paths"]["/api/runs"]["get"]
