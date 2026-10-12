"""The agent skill: a SKILL.md (curated guide + endpoint reference generated from the live
OpenAPI schema) and a zip of the skill folder, both public."""

import io
import json
import re
import zipfile
from importlib import resources

import yaml
from httpx import ASGITransport, AsyncClient

PARAM = re.compile(r"\{[^}/]+\}")
GUIDE_PATH = re.compile(r"(?<![\w/.:])/api(?:/[A-Za-z0-9_.{}-]+)+")  # not a host's /api


def guide_text() -> str:
    return resources.files("voice_eval.modules.skill").joinpath("guide.md").read_text("utf-8")


def normalized(path: str) -> str:
    """The path with every parameter (`{run_id}`, `{runId}`) as `{}` and no trailing dot."""
    return PARAM.sub("{}", path.rstrip("."))


def app_paths(app) -> set[str]:
    """Every HTTP path of the app's OpenAPI schema and every WebSocket path, normalized.

    WebSockets are not in OpenAPI: they are read from the live router, mounted under `/api`.
    """
    from voice_eval.modules.runs import live_api

    sockets = {"/api" + route.path for route in live_api.router.routes}
    assert sockets, "the live router declares its WebSocket routes"
    docs = {app.docs_url, app.openapi_url}  # Swagger UI and its schema are not operations
    return {normalized(path) for path in [*app.openapi()["paths"], *sockets, *docs]}


async def fresh_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver")


async def test_skill_is_public(app):
    async with await fresh_client(app) as anonymous:
        for path in ("/api/skill", "/api/skill.zip"):
            response = await anonymous.get(path)
            assert response.status_code == 200, path


async def test_skill_is_markdown_with_frontmatter(user_client):
    response = await user_client.get("/api/skill")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    text = response.text
    frontmatter = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert frontmatter, "SKILL.md starts with YAML frontmatter"
    fields = yaml.safe_load(frontmatter.group(1))
    assert set(fields) == {"name", "description"}
    assert fields["name"] == "voice-evaluator"
    assert 80 < len(fields["description"]) <= 1024  # the SKILL.md format's limit
    assert "## Endpoint reference" in text
    # the curated guide follows the frontmatter, the generated reference comes after it
    assert text.index(guide_text().strip().splitlines()[0]) < text.index("## Endpoint reference")


async def test_every_api_operation_is_in_the_reference(app, user_client):
    text = (await user_client.get("/api/skill")).text
    reference = text[text.index("## Endpoint reference") :]
    operations = [
        (method.upper(), path)
        for path, item in app.openapi()["paths"].items()
        for method in item
        if method in {"get", "post", "put", "patch", "delete"}
    ]
    assert len(operations) > 20
    # Exact headings: "GET /api/runs" must not pass just because "GET /api/runs/{run_id}" exists.
    headings = set(re.findall(r"^### ([A-Z]+ \S+)$", reference, flags=re.MULTILINE))
    missing = [f"{m} {p}" for m, p in operations if f"{m} {p}" not in headings]
    assert not missing, f"operations missing from the generated reference: {missing}"


async def test_reference_resolves_schemas_and_skips_hidden_routes(app, user_client):
    from fastapi import APIRouter

    hidden = APIRouter()

    @hidden.get("/api/internal-only", include_in_schema=False)
    async def internal() -> dict:
        return {}

    routes_before = list(app.router.routes)
    app.include_router(hidden)
    app.openapi_schema = None  # rebuild with the extra route
    try:
        text = (await user_client.get("/api/skill")).text
    finally:  # leave the shared app as it was
        app.router.routes[:] = routes_before
        app.openapi_schema = None
    assert "/api/internal-only" not in text
    assert "$ref" not in text
    reference = text[text.index("## Endpoint reference") :]
    launch = reference[reference.index("POST /api/runs\n") :]
    launch = launch[: launch.index("\n### ")]
    for field in ("scenarioIds", "repetitions", "concurrency", "label"):
        assert f"`{field}`" in launch, field
    assert "required" in launch


async def test_every_path_the_guide_mentions_exists(app):
    served = app_paths(app)
    mentioned = {match.group(0) for match in GUIDE_PATH.finditer(guide_text())}
    assert len(mentioned) > 10
    unknown = sorted(path for path in mentioned if normalized(path) not in served)
    assert not unknown, f"guide.md mentions paths the app does not serve: {unknown}"


def test_guide_contains_no_real_looking_key():
    text = guide_text()
    assert not re.search(r"ve_[a-z0-9]{8}_[A-Za-z0-9]{43}", text)
    assert not re.search(r"sk-[A-Za-z0-9]{20,}", text)


async def test_zip_contains_the_skill_folder(app, user_client):
    response = await user_client.get("/api/skill.zip")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert sorted(archive.namelist()) == [
            "voice-evaluator/SKILL.md",
            "voice-evaluator/reference/openapi.json",
        ]
        skill = archive.read("voice-evaluator/SKILL.md").decode("utf-8")
        spec = json.loads(archive.read("voice-evaluator/reference/openapi.json"))
    assert skill.startswith("---\nname: voice-evaluator\n")
    assert spec["paths"].keys() == app.openapi()["paths"].keys()


async def test_skill_works_with_an_api_key(app, user_client):
    created = await user_client.post("/api/api-keys", json={"name": "agent"})
    assert created.status_code == 201, created.text
    key = created.json()["key"]
    async with await fresh_client(app) as agent:
        headers = {"Authorization": f"Bearer {key}"}
        skill = await agent.get("/api/skill", headers=headers)
        archive = await agent.get("/api/skill.zip", headers=headers)
    assert skill.status_code == 200 and skill.text.startswith("---\nname: voice-evaluator\n")
    assert archive.status_code == 200
    assert key not in skill.text
