"""Real Home Assistant setup, state, reauth, options and unload tests."""

from unittest.mock import AsyncMock, patch

import pytest
from custom_components.pulshealth.api import InvalidAuth, PulsHealthError
from custom_components.pulshealth.const import DOMAIN
from custom_components.pulshealth.coordinator import PulsHealthCoordinator
from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import UpdateFailed
from pytest_homeassistant_custom_component.common import MockConfigEntry
from test_api import ACCOUNT, BASE, USER, snapshot

DATA = {"name": "Fitness", "url": BASE, "access_token": "test-token", "user_id": USER}


@pytest.mark.asyncio
async def test_ui_setup_duplicate_and_options(hass):
    with (
        patch(
            "custom_components.pulshealth.api.PulsHealthClient.account",
            new=AsyncMock(return_value=ACCOUNT),
        ),
        patch("custom_components.pulshealth.async_setup_entry", return_value=True),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}, data=DATA
        )
        assert result["type"] == FlowResultType.CREATE_ENTRY
        await hass.async_block_till_done()
        entry = result["result"]
        assert entry.data["user_id"] == USER
        assert entry.unique_id == f"{BASE}|{USER}"
        duplicate = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}, data=DATA
        )
        assert duplicate["reason"] == "already_configured"
        options = await hass.config_entries.options.async_init(entry.entry_id)
        result = await hass.config_entries.options.async_configure(
            options["flow_id"], {"scan_interval": 60}
        )
        assert result["type"] == FlowResultType.CREATE_ENTRY
        assert entry.options["scan_interval"] == 60


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,expected", [(InvalidAuth(), "invalid_auth"), (PulsHealthError(), "cannot_connect")]
)
async def test_ui_error(hass, error, expected):
    with patch("custom_components.pulshealth.api.PulsHealthClient.account", side_effect=error):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}, data=DATA
        )
        assert result["errors"]["base"] == expected


@pytest.mark.asyncio
async def test_entities_outage_midnight_and_unload(hass):
    entry = MockConfigEntry(domain=DOMAIN, title="Fitness", unique_id=f"{BASE}|{USER}", data=DATA)
    entry.add_to_hass(hass)
    data = snapshot(
        metrics=[
            {
                "identifier": "HKQuantityTypeIdentifierStepCount",
                "days": [{"date": "2026-10-09", "value": 4321}],
            }
        ]
    )
    with patch(
        "custom_components.pulshealth.api.PulsHealthClient.snapshot",
        new=AsyncMock(return_value=data),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert hass.states.get("sensor.fitness_steps_today").state == "4321"
        assert hass.states.get("binary_sensor.fitness_all_rings_closed_today").state == "unknown"
        assert hass.states.get("sensor.fitness_last_sync").state.endswith("+00:00")
        coordinator = entry.runtime_data
        with patch.object(coordinator.client, "snapshot", side_effect=PulsHealthError()):
            await coordinator.async_refresh()
            await hass.async_block_till_done()
            assert hass.states.get("sensor.fitness_steps_today").state == "unavailable"
        coordinator.async_set_updated_data(snapshot())
        await hass.async_block_till_done()
        assert hass.states.get("sensor.fitness_steps_today").state == "unknown"
        assert await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()
        assert hass.states.get("sensor.fitness_steps_today").state == "unavailable"


@pytest.mark.asyncio
async def test_coordinator_auth_failure(hass):
    entry = MockConfigEntry(domain=DOMAIN, data=DATA)
    coordinator = PulsHealthCoordinator(hass, entry, AsyncMock())
    coordinator.client.snapshot.side_effect = InvalidAuth()
    with pytest.raises(ConfigEntryAuthFailed):
        await coordinator._async_update_data()
    coordinator.client.snapshot.side_effect = PulsHealthError()
    with pytest.raises(UpdateFailed):
        await coordinator._async_update_data()


@pytest.mark.asyncio
async def test_reauth_updates_token_without_changing_account(hass):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=f"{BASE}|{USER}", data=DATA)
    entry.add_to_hass(hass)
    with (
        patch(
            "custom_components.pulshealth.api.PulsHealthClient.account",
            new=AsyncMock(return_value=ACCOUNT),
        ),
        patch.object(hass.config_entries, "async_reload", return_value=True),
    ):
        flow = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id}, data=DATA
        )
        result = await hass.config_entries.flow.async_configure(
            flow["flow_id"], {"access_token": "replacement"}
        )
        assert result["reason"] == "reauth_successful"
        assert entry.data["access_token"] == "replacement"
        assert entry.data["user_id"] == USER
