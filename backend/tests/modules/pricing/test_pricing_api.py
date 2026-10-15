"""`/api/pricing`: the seeded price table, its validation and replacement."""

SEEDED = {
    "gpt-6-luna": {"textIn": 0.1, "cachedTextIn": 0.01, "audioIn": None, "cachedAudioIn": None,
                   "textOut": 0.5, "audioOut": None},
    "gpt-realtime-2.1": {"textIn": 4.0, "cachedTextIn": 0.4, "audioIn": 32.0,
                         "cachedAudioIn": 0.4, "textOut": 24.0, "audioOut": 64.0},
    "gpt-realtime-2.1-mini": {"textIn": 0.6, "cachedTextIn": 0.06, "audioIn": 10.0,
                              "cachedAudioIn": 0.3, "textOut": 2.4, "audioOut": 20.0},
    "gpt-4o-mini-tts": {"textIn": 0.6, "cachedTextIn": None, "audioIn": None,
                        "cachedAudioIn": None, "textOut": None, "audioOut": 12.0},
}  # fmt: skip


async def test_the_table_is_seeded_with_the_published_list_prices(user_client):
    response = await user_client.get("/api/pricing")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "https://developers.openai.com/api/docs/pricing"
    assert body["asOf"] == "2026-10-15"
    assert (body["currency"], body["unit"]) == ("USD", "per 1M tokens")
    assert "Approximate" in body["note"] and "Azure" in body["note"]
    assert {item.pop("model"): item for item in body["items"]} == SEEDED


async def test_prices_can_be_replaced_and_are_validated(user_client):
    items = [
        {"model": "gpt-6-luna", "textIn": 0.2, "cachedTextIn": 0.02, "textOut": 0.8},
        {"model": "my-model", "audioOut": 1.5},
    ]
    try:
        response = await user_client.put("/api/pricing", json={"items": items})
        assert response.status_code == 200, response.text
        stored = {item["model"]: item for item in response.json()["items"]}
        assert set(stored) == {"gpt-6-luna", "my-model"}
        assert stored["gpt-6-luna"]["textOut"] == 0.8
        assert stored["my-model"]["textIn"] is None
        assert (await user_client.get("/api/pricing")).json()["items"] == response.json()["items"]

        for bad in (
            [{"model": "gpt-6-luna", "textIn": -1}],
            [{"model": "gpt-6-luna", "textIn": "cheap"}],
            [{"model": "a"}, {"model": "a"}],
            [{"model": "bad model"}],
            [{"model": "gpt-6-luna", "videoIn": 1}],
            [{"model": "gpt-6-luna", "textIn": 0.00005}],  # stored with 4 decimals: would be 0
        ):
            refused = await user_client.put("/api/pricing", json={"items": bad})
            assert refused.status_code == 422, bad
    finally:
        seeded = [{"model": model, **prices} for model, prices in SEEDED.items()]
        await user_client.put("/api/pricing", json={"items": seeded})


async def test_pricing_needs_authentication(client):
    assert (await client.get("/api/pricing")).status_code == 401
    assert (await client.put("/api/pricing", json={"items": []})).status_code == 401
