"""UI configuration, token replacement, and polling options."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_NAME, CONF_URL
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    InvalidAuth,
    PulsHealthClient,
    PulsHealthError,
    normalize_url,
    normalize_user,
)
from .const import CONF_USER_ID, DEFAULT_INTERVAL, DOMAIN

TOKEN = selector.TextSelector(
    selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
)


class PulsHealthConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Pin each entry to a server URL and account UUID."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
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
            step_id="user",
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
