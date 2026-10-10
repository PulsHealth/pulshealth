"""Apple Health data from a PulsHealth product API."""

from homeassistant.const import CONF_ACCESS_TOKEN, CONF_URL, Platform
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PulsHealthClient
from .const import CONF_USER_ID
from .coordinator import PulsHealthCoordinator

PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup_entry(hass, entry):
    client = PulsHealthClient(
        async_get_clientsession(hass),
        entry.data[CONF_URL],
        entry.data[CONF_ACCESS_TOKEN],
        entry.data[CONF_USER_ID],
    )
    coordinator = PulsHealthCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_unload_entry(hass, entry):
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_reload_entry(hass, entry):
    await hass.config_entries.async_reload(entry.entry_id)
