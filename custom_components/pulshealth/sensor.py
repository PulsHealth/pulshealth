"""Bounded health summaries as Home Assistant sensors."""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import EntityCategory, UnitOfEnergy, UnitOfLength, UnitOfTime

from .entity import PulsHealthEntity

PARALLEL_UPDATES = 0


def description(
    key, name, unit=None, device_class=None, state_class=None, category=None
):
    return SensorEntityDescription(
        key=key,
        name=name,
        native_unit_of_measurement=unit,
        device_class=device_class,
        state_class=state_class,
        entity_category=category,
    )


SENSORS = (
    description("steps", "Steps today", "steps", state_class=SensorStateClass.TOTAL),
    description(
        "walking_running_distance",
        "Walking and running distance today",
        UnitOfLength.METERS,
        SensorDeviceClass.DISTANCE,
        SensorStateClass.TOTAL,
    ),
    description(
        "active_energy",
        "Active energy today",
        UnitOfEnergy.KILO_CALORIE,
        SensorDeviceClass.ENERGY,
        SensorStateClass.TOTAL,
    ),
    description(
        "move_energy",
        "Move energy today",
        UnitOfEnergy.KILO_CALORIE,
        SensorDeviceClass.ENERGY,
        SensorStateClass.TOTAL,
    ),
    description(
        "move_energy_goal",
        "Move energy goal",
        UnitOfEnergy.KILO_CALORIE,
        SensorDeviceClass.ENERGY,
    ),
    description(
        "exercise",
        "Exercise today",
        UnitOfTime.MINUTES,
        SensorDeviceClass.DURATION,
        SensorStateClass.TOTAL,
    ),
    description(
        "exercise_goal", "Exercise goal", UnitOfTime.MINUTES, SensorDeviceClass.DURATION
    ),
    description(
        "stand",
        "Stand hours today",
        UnitOfTime.HOURS,
        SensorDeviceClass.DURATION,
        SensorStateClass.TOTAL,
    ),
    description(
        "stand_goal", "Stand goal", UnitOfTime.HOURS, SensorDeviceClass.DURATION
    ),
    description(
        "move_time",
        "Move time today",
        UnitOfTime.MINUTES,
        SensorDeviceClass.DURATION,
        SensorStateClass.TOTAL,
    ),
    description(
        "move_time_goal",
        "Move time goal",
        UnitOfTime.MINUTES,
        SensorDeviceClass.DURATION,
    ),
    description(
        "sleep",
        "Latest sleep",
        UnitOfTime.MINUTES,
        SensorDeviceClass.DURATION,
        SensorStateClass.MEASUREMENT,
    ),
    description(
        "last_workout", "Last workout", device_class=SensorDeviceClass.TIMESTAMP
    ),
    description(
        "workout_duration",
        "Last workout duration",
        UnitOfTime.SECONDS,
        SensorDeviceClass.DURATION,
    ),
    description(
        "workout_distance",
        "Last workout distance",
        UnitOfLength.METERS,
        SensorDeviceClass.DISTANCE,
    ),
    description(
        "workout_energy",
        "Last workout energy",
        UnitOfEnergy.KILO_CALORIE,
        SensorDeviceClass.ENERGY,
    ),
    description(
        "last_sync",
        "Last sync",
        device_class=SensorDeviceClass.TIMESTAMP,
        category=EntityCategory.DIAGNOSTIC,
    ),
)


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(
        PulsHealthSensor(entry.runtime_data, entry, desc) for desc in SENSORS
    )


class PulsHealthSensor(PulsHealthEntity, SensorEntity):
    """Read one value from the shared coordinator snapshot."""

    def __init__(self, coordinator, entry, desc):
        super().__init__(coordinator, entry, desc.key)
        self.entity_description = desc

    @property
    def native_value(self):
        value = self.coordinator.data["values"].get(self.entity_description.key)
        if value is not None and self.device_class == SensorDeviceClass.TIMESTAMP:
            return datetime.fromtimestamp(value / 1000, UTC)
        return value

    @property
    def last_reset(self):
        """Give daily totals a new statistics period at account midnight."""
        if self.state_class != SensorStateClass.TOTAL:
            return None
        data = self.coordinator.data
        return datetime.combine(
            date.fromisoformat(data["date"]), time.min, ZoneInfo(data["time_zone"])
        )

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data
        key = self.entity_description.key
        if key.startswith("workout_") or key == "last_workout":
            return {k: v for k, v in data["workout"].items() if v is not None}
        if key == "sleep":
            return {"date": data["sleep_date"], "time_zone": data["time_zone"]}
        if key == "last_sync":
            return None
        return {"date": data["date"], "time_zone": data["time_zone"]}
