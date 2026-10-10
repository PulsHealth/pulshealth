"""Activity goal completion, with missing rings preserved as unknown."""

from homeassistant.components.binary_sensor import BinarySensorEntity

from .entity import PulsHealthEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(
        [PulsHealthRingsClosed(entry.runtime_data, entry, "rings_closed")]
    )


class PulsHealthRingsClosed(PulsHealthEntity, BinarySensorEntity):
    _attr_name = "All rings closed today"
    _attr_icon = "mdi:circle-triple"

    @property
    def is_on(self):
        return self.coordinator.data["values"]["rings_closed"]

    @property
    def extra_state_attributes(self):
        return {
            "date": self.coordinator.data["date"],
            "time_zone": self.coordinator.data["time_zone"],
        }
