"""Shared account device and stable entity identifiers."""

from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


class PulsHealthEntity(CoordinatorEntity):
    """An entity belonging to one configured account."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, entry, key):
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.unique_id}|{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id)},
            name=entry.title,
            manufacturer="PulsHealth",
            model="Health account",
        )
