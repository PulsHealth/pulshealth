"""UI configuration, token replacement, and polling options."""

import logging

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_NAME, CONF_URL
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.config_entry_oauth2_flow import AbstractOAuth2FlowHandler

from .api import (
    InvalidAuth,
    PulsHealthClient,
    PulsHealthError,
    normalize_url,
    normalize_user,
)
from .const import CONF_USER_ID, DEFAULT_INTERVAL, DOMAIN
from .oauth import DEFAULT_ISSUER, PulsHealthOAuth

_LOGGER = logging.getLogger(__name__)

TOKEN = selector.TextSelector(
    selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
)


class PulsHealthConfigFlow(AbstractOAuth2FlowHandler, domain=DOMAIN):
    """Pin each entry to a server URL and account UUID."""

    VERSION = 1
    DOMAIN = DOMAIN

    @property
    def logger(self):
        return _LOGGER

    async def async_step_user(self, user_input=None):
        if user_input and CONF_ACCESS_TOKEN in user_input:
            return await self.async_step_self_hosted(user_input)
        return self.async_show_menu(
            step_id="user", menu_options=["hosted", "self_hosted"]
        )

    async def async_step_hosted(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                self._name = user_input[CONF_NAME]
                self._issuer = normalize_url(user_input[CONF_URL])
                if not self._issuer.startswith("https://"):
                    raise ValueError("OAuth requires HTTPS")
                implementation = PulsHealthOAuth(self.hass, self._issuer, "")
                async with async_get_clientsession(self.hass).post(
                    f"{self._issuer}/oauth/register",
                    json={
                        "client_name": "Home Assistant",
                        "redirect_uris": [implementation.redirect_uri],
                        "token_endpoint_auth_method": "none",
                        "grant_types": ["authorization_code", "refresh_token"],
                        "response_types": ["code"],
                        "scope": "health:read",
                    },
                    allow_redirects=False,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status != 201:
                        raise PulsHealthError("Registration failed")
                    registration = await response.json()
                    self._client_id = registration["client_id"]
                    if not isinstance(self._client_id, str) or not self._client_id:
                        raise PulsHealthError("Invalid client registration")
                self.flow_impl = PulsHealthOAuth(
                    self.hass, self._issuer, self._client_id
                )
                return await self.async_step_auth()
            except ValueError:
                errors["base"] = "invalid_input"
            except (
                PulsHealthError,
                aiohttp.ClientError,
                TimeoutError,
                KeyError,
                TypeError,
            ):
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="hosted",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME, default="PulsHealth"): str,
                    vol.Required(CONF_URL, default=DEFAULT_ISSUER): str,
                }
            ),
            errors=errors,
        )

    async def async_oauth_create_entry(self, data):
        client = PulsHealthClient(
            async_get_clientsession(self.hass),
            f"{self._issuer}/api/health",
            data["token"]["access_token"],
        )
        try:
            await client.account()
        except (PulsHealthError, ValueError):
            return self.async_abort(reason="cannot_connect")
        await self.async_set_unique_id(f"{client.url}|{client.user_id}")
        updates = {
            **data,
            "issuer": self._issuer,
            "client_id": self._client_id,
            CONF_URL: client.url,
            CONF_USER_ID: client.user_id,
        }
        if self.source == config_entries.SOURCE_REAUTH:
            entry = self._get_reauth_entry()
            if (
                entry.data[CONF_USER_ID] != client.user_id
                or entry.data[CONF_URL] != client.url
            ):
                return self.async_abort(reason="wrong_account")
            return self.async_update_reload_and_abort(entry, data_updates=updates)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=self._name, data=updates)

    async def async_step_self_hosted(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                data = dict(user_input)
                data[CONF_URL] = normalize_url(data[CONF_URL])
                data[CONF_USER_ID] = normalize_user(data.get(CONF_USER_ID, ""))
                client = PulsHealthClient(
                    async_get_clientsession(self.hass),
                    data[CONF_URL],
                    data[CONF_ACCESS_TOKEN],
                    data[CONF_USER_ID],
                )
                await client.account()
                data[CONF_USER_ID] = client.user_id
                await self.async_set_unique_id(f"{client.url}|{client.user_id}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=data[CONF_NAME], data=data)
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except (PulsHealthError, KeyError, TypeError):
                errors["base"] = "cannot_connect"
            except ValueError:
                errors["base"] = "invalid_input"
        return self.async_show_form(
            step_id="self_hosted",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME, default="PulsHealth"): str,
                    vol.Required(CONF_URL): str,
                    vol.Required(CONF_ACCESS_TOKEN): TOKEN,
                    vol.Optional(CONF_USER_ID, default=""): str,
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data):
        if "token" in entry_data:
            entry = self._get_reauth_entry()
            self._name = entry.title
            self._issuer = entry_data["issuer"]
            self._client_id = entry_data["client_id"]
            self.flow_impl = PulsHealthOAuth(self.hass, self._issuer, self._client_id)
            return await self.async_step_auth()
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        errors = {}
        if user_input is not None:
            entry = self._get_reauth_entry()
            try:
                client = PulsHealthClient(
                    async_get_clientsession(self.hass),
                    entry.data[CONF_URL],
                    user_input[CONF_ACCESS_TOKEN],
                    entry.data[CONF_USER_ID],
                )
                await client.account()
                return self.async_update_reload_and_abort(
                    entry, data_updates=user_input
                )
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except (PulsHealthError, ValueError, KeyError, TypeError):
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_ACCESS_TOKEN): TOKEN}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return PulsHealthOptionsFlow()


class PulsHealthOptionsFlow(config_entries.OptionsFlow):
    """Polling cadence in seconds."""

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "scan_interval",
                        default=self.config_entry.options.get(
                            "scan_interval", DEFAULT_INTERVAL
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=60, max=3600)),
                }
            ),
        )
