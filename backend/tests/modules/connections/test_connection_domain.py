import pytest

from voice_eval.modules.connections.domain import (
    ConnectionKind,
    InvalidConnectionInput,
    parse_config,
    parse_secrets,
    reveal,
    secret_hint,
)


def config(kind, data, *, dev=False):
    return parse_config(ConnectionKind(kind), data, allow_local_http=dev)


def error_locs(info) -> list[tuple]:
    return [tuple(e["loc"]) for e in info.value.errors]


def test_openai_defaults():
    parsed = config("openai", {})
    assert parsed.model_dump() == {
        "base_url": "https://api.openai.com/v1",
        "tts_model": "gpt-4o-mini-tts",
        "tts_voice": "alloy",
    }


def test_config_accepts_camel_case_and_strips_trailing_slash():
    parsed = config("openai", {"baseUrl": "https://proxy.example.com/v1/", "ttsVoice": "coral"})
    assert (parsed.base_url, parsed.tts_voice) == ("https://proxy.example.com/v1", "coral")


def test_azure_openai_requires_its_fields():
    with pytest.raises(InvalidConnectionInput) as info:
        config("azure_openai", {})
    assert set(error_locs(info)) == {
        ("config", "endpoint"),
        ("config", "apiVersion"),
        ("config", "ttsDeployment"),
    }
    parsed = config(
        "azure_openai",
        {
            "endpoint": "https://res.openai.azure.com",
            "apiVersion": "2025-03-01-preview",
            "ttsDeployment": "my-tts",
        },
    )
    assert parsed.tts_voice == "alloy"


@pytest.mark.parametrize(
    "url",
    [
        "http://api.example.com",  # plain http
        "ftp://api.example.com",
        "https://user:pass@api.example.com",  # credentials in the URL
        "https://user@api.example.com",
        "https://api.example.com/v1?x=1",  # query strings are not allowed
        "https://api.example.com/#frag",
        "https://api.example.com\\@evil.example",  # parser confusion
        "https://api.example .com",
        "https://",
        "not a url",
        "http://localhost:8080",  # local http only in development
    ],
)
def test_url_rules_reject(url):
    with pytest.raises(InvalidConnectionInput) as info:
        config("openai", {"baseUrl": url})
    assert error_locs(info) == [("config", "baseUrl")]
    assert all("user:pass" not in e["msg"] for e in info.value.errors)


@pytest.mark.parametrize("url", ["http://localhost:8080/v1", "http://127.0.0.1:9000"])
def test_local_http_allowed_only_in_development(url):
    assert config("openai", {"baseUrl": url}, dev=True).base_url == url.rstrip("/")
    with pytest.raises(InvalidConnectionInput):
        config("openai", {"baseUrl": url}, dev=False)
    with pytest.raises(InvalidConnectionInput):
        config("openai", {"baseUrl": url.replace("http://", "http://u:p@")}, dev=True)


def test_azure_speech_needs_exactly_one_of_region_or_endpoint():
    assert config("azure_speech", {"region": "eastus", "voice": "es-MX-DaliaNeural"}).region
    assert config("azure_speech", {"endpoint": "https://res.cognitiveservices.azure.com"})
    for bad in ({}, {"region": "eastus", "endpoint": "https://res.cognitiveservices.azure.com"}):
        with pytest.raises(InvalidConnectionInput):
            config("azure_speech", bad)


@pytest.mark.parametrize("region", ["east us", "evil.com/x", "eastus.attacker.net", "EASTUS#"])
def test_azure_speech_region_cannot_inject_a_host(region):
    with pytest.raises(InvalidConnectionInput):
        config("azure_speech", {"region": region})


@pytest.mark.parametrize("deployment", ["../models", "a/b", "x?y=1", ""])
def test_identifiers_cannot_inject_paths(deployment):
    data = {
        "endpoint": "https://res.openai.azure.com",
        "apiVersion": "2025-03-01-preview",
        "ttsDeployment": deployment,
    }
    with pytest.raises(InvalidConnectionInput):
        config("azure_openai", data)


def test_langfuse_config_and_unknown_fields():
    parsed = config("langfuse", {"host": "https://cloud.langfuse.com", "publicKey": "pk-lf-123"})
    assert parsed.public_key == "pk-lf-123"
    with pytest.raises(InvalidConnectionInput) as info:
        config("langfuse", {"host": "https://cloud.langfuse.com", "publicKey": "pk", "x": 1})
    assert ("config", "x") in error_locs(info)


@pytest.mark.parametrize(
    ("kind", "field", "data"),
    [
        ("openai", "api_key", {"apiKey": "sk-abcdefghijklmnop"}),
        ("azure_openai", "api_key", {"apiKey": "sk-abcdefghijklmnop"}),
        ("azure_speech", "key", {"key": "sk-abcdefghijklmnop"}),
        ("langfuse", "secret_key", {"secretKey": "sk-abcdefghijklmnop"}),
    ],
)
def test_secrets_per_kind(kind, field, data):
    parsed = parse_secrets(ConnectionKind(kind), data)
    assert reveal(parsed) == {field: "sk-abcdefghijklmnop"}
    assert "sk-abcdefghijklmnop" not in repr(parsed)
    assert secret_hint(parsed) == "••••mnop"


def test_secret_errors_never_echo_the_value():
    with pytest.raises(InvalidConnectionInput) as info:
        parse_secrets(ConnectionKind.OPENAI, {"apiKey": "sk-leak-me-please", "apiKye": "x"})
    assert "sk-leak-me-please" not in str(info.value.errors)
    with pytest.raises(InvalidConnectionInput):
        parse_secrets(ConnectionKind.OPENAI, {"apiKey": ""})
    with pytest.raises(InvalidConnectionInput):
        parse_secrets(ConnectionKind.OPENAI, {})


@pytest.mark.parametrize(
    ("value", "hint"),
    [("abc", "••••"), ("12345678901", "••••"), ("123456789012", "••••9012")],
)
def test_secret_hint_only_reveals_last_four_of_long_secrets(value, hint):
    assert secret_hint(parse_secrets(ConnectionKind.OPENAI, {"apiKey": value})) == hint
