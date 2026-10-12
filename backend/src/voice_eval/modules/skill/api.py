"""HTTP API of the skill module: `/api/skill` and `/api/skill.zip` (behind authentication).

Both are rendered on every request from the running app's OpenAPI schema (`app.openapi()`,
built once and cached by FastAPI, whether or not `/openapi.json` is exposed), so the endpoint
reference never drifts from the code.
"""

from fastapi import APIRouter, Request, Response

from voice_eval.modules.skill.render import SKILL_NAME, render_skill, skill_zip

router = APIRouter(tags=["skill"])


def _origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@router.get(
    "/skill",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}}}},
)
async def get_skill(request: Request) -> Response:
    """The agent skill as one `SKILL.md`: what voice-evaluator is, the flows, how to read the
    results, and an endpoint reference generated from this app."""
    text = render_skill(request.app.openapi(), origin=_origin(request))
    return Response(text, media_type="text/markdown; charset=utf-8")


@router.get(
    "/skill.zip",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def get_skill_zip(request: Request) -> Response:
    """The skill folder (`voice-evaluator/SKILL.md`, `voice-evaluator/reference/openapi.json`),
    ready to unzip into an agent's skills directory."""
    data = skill_zip(request.app.openapi(), origin=_origin(request))
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{SKILL_NAME}-skill.zip"'},
    )
