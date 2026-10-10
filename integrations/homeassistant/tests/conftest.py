"""Use the real Home Assistant test runtime and load this custom component."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def custom_components_enabled(enable_custom_integrations):
    """Enable custom integration discovery in Home Assistant."""
