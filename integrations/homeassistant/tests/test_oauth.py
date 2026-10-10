"""Hosted browser authorization, account binding, and rotating OAuth tokens."""

import time
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
from aiohttp import web
from custom_components.pulshealth.api import InvalidAuth, PulsHealthClient
from custom_components.pulshealth.const import DOMAIN
from custom_components.pulshealth.oauth import PulsHealthOAuth
from homeassistant.const import CONF_URL
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.config_entry_oauth2_flow import OAuth2Session
from pytest_homeassistant_custom_component.common import MockConfigEntry

USER = "5ea4d000-0000-4000-8000-000000000001"
ISSUER = "https://app.pulshealth.com"
TOKEN = {
    "access_token": "access",
    "refresh_token": "refresh",
    "expires_in": 1800,
    "token_type": "Bearer",
}


@pytest.mark.asyncio
async def test_hosted_flow_pkce_and_account(hass):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] == "menu"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "hosted"}
    )
    assert result["step_id"] == "hosted"
    response = MagicMock(status=201)
    response.json = AsyncMock(return_value={"client_id": "pc_installation"})
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=response)
    context.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.post.return_value = context
    with patch(
        "custom_components.pulshealth.config_flow.async_get_clientsession", return_value=session
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"name": "Fitness", "url": ISSUER}
        )
    assert result["type"] == "external"
    params = parse_qs(urlsplit(result["url"]).query)
    assert params["resource"] == [f"{ISSUER}/api/health"]
    assert params["code_challenge_method"] == ["S256"]
    assert len(params["code_challenge"][0]) == 43
    assert params["redirect_uri"] == ["https://my.home-assistant.io/redirect/oauth"]
    assert session.post.call_args.kwargs["allow_redirects"] is False
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"code": "once", "state": {"redirect_uri": params["redirect_uri"][0]}}
    )

    async def account(client):
        client.user_id = USER
        return {"userID": USER, "timeZone": "UTC"}

    with (
        patch.object(
            PulsHealthOAuth, "_token_request", new=AsyncMock(return_value=dict(TOKEN))
        ) as exchange,
        patch.object(PulsHealthClient, "account", new=account),
        patch("custom_components.pulshealth.async_setup_entry", return_value=True),
    ):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
    assert result["type"] == "create_entry"
    assert result["data"]["user_id"] == USER
    assert result["data"][CONF_URL] == f"{ISSUER}/api/health"
    assert "access_token" not in result["data"]
    assert result["data"]["token"]["refresh_token"] == "refresh"
    payload = exchange.call_args.args[0]
    assert payload["resource"] == f"{ISSUER}/api/health"
    assert len(payload["code_verifier"]) == 128


@pytest.mark.asyncio
async def test_refresh_rotates_saved_token_and_maps_revocation(
    hass, aiohttp_server, socket_enabled
):
    revoked = False
    received = []

    async def token(request):
        received.append(dict(await request.post()))
        if revoked:
            return web.json_response({"error": "invalid_grant"}, status=400)
        return web.json_response(
            {**TOKEN, "access_token": "new-access", "refresh_token": "rotated"}
        )

    async def users(request):
        assert request.headers["Authorization"] == "Bearer new-access"
        return web.json_response({"users": [{"userID": USER, "timeZone": "UTC"}], "default": USER})

    app = web.Application()
    app.router.add_post("/oauth/token", token)
    app.router.add_get("/api/health/v1/users", users)
    server = await aiohttp_server(app)
    issuer = str(server.make_url("")).rstrip("/")
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={
            "issuer": issuer,
            "client_id": "pc_installation",
            "url": f"{issuer}/api/health",
            "user_id": USER,
            "token": {**TOKEN, "expires_at": 0},
        },
    )
    entry.add_to_hass(hass)
    oauth = OAuth2Session(hass, entry, PulsHealthOAuth(hass, issuer, "pc_installation"))
    client = PulsHealthClient(
        async_get_clientsession(hass), f"{issuer}/api/health", "", oauth_session=oauth
    )
    await client.account()
    assert entry.data["token"]["refresh_token"] == "rotated"
    assert received[0] == {
        "grant_type": "refresh_token",
        "client_id": "pc_installation",
        "refresh_token": "refresh",
    }
    revoked = True
    hass.config_entries.async_update_entry(
        entry,
        data={**entry.data, "token": {**entry.data["token"], "expires_at": time.time() - 100}},
    )
    with pytest.raises(InvalidAuth):
        await client.account()
    assert received[1]["refresh_token"] == "rotated"
    await hass.async_block_till_done()
    assert any(
        f["context"]["source"] == "reauth" for f in hass.config_entries.flow.async_progress()
    )
