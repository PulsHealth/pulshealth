"""Shared polling and Home Assistant error handling."""

import logging
from datetime import timedelta

from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import InvalidAuth, PulsHealthError
from .const import DEFAULT_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class PulsHealthCoordinator(DataUpdateCoordinator):
    """Publish only complete snapshots, with automatic outage recovery."""

    def __init__(self, hass, entry, client):
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(
                seconds=entry.options.get("scan_interval", DEFAULT_INTERVAL)
            ),
            always_update=False,
        )
        self.options = dict(entry.options)
        self.client = client

    async def _async_update_data(self):
        try:
            return await self.client.snapshot()
        except InvalidAuth as err:
            raise ConfigEntryAuthFailed("Product API token rejected") from err
        except (PulsHealthError, KeyError, TypeError, ValueError) as err:
            raise UpdateFailed("Unable to read PulsHealth snapshot") from err
