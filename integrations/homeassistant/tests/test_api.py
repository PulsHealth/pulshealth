"""Contract, calendar, authentication and missing-data regression tests."""

from datetime import datetime, timezone

import aiohttp
import pytest
from aiohttp import web
from custom_components.pulshealth.api import (
    InvalidAuth,
    PulsHealthClient,
    PulsHealthError,
    normalize_url,
    project_snapshot,
)

USER = "11111111-1111-4111-8111-111111111111"
BASE = "https://api.example.test"
ACCOUNT = {"userID": USER, "timeZone": "America/Los_Angeles", "lastSync": 1791580000000}


def snapshot(metrics=None, ring=None, nights=None, workouts=None):
    return project_snapshot(
        "2026-10-09",
        ACCOUNT,
        {"metrics": metrics or []},
        {"days": ring or []},
        {"nights": nights or []},
        {"workouts": workouts or []},
    )


def test_missing_and_yesterday_are_unknown():
    data = snapshot(
        metrics=[
            {
                "identifier": "HKQuantityTypeIdentifierStepCount",
                "days": [{"date": "2026-10-08", "value": 9000}],
            }
        ],
        ring=[{"date": "2026-10-08", "moveKcal": 600}],
    )
    assert data["values"]["steps"] is None
    assert data["values"]["move_energy"] is None
    assert data["values"]["rings_closed"] is None


def test_zero_is_a_reading_and_move_time_mode_closes_rings():
    data = snapshot(
        metrics=[
            {
                "identifier": "HKQuantityTypeIdentifierStepCount",
                "days": [{"date": "2026-10-09", "value": 0}],
            }
        ],
        ring=[
            {
                "date": "2026-10-09",
                "moveMode": 2,
                "moveTimeMin": 60,
                "moveTimeGoalMin": 60,
                "exerciseMin": 31,
                "exerciseGoalMin": 30,
                "standHours": 12,
                "standGoalHours": 12,
            }
        ],
    )
    assert data["values"]["steps"] == 0
    assert data["values"]["rings_closed"] is True
    assert data["values"]["move_energy"] is None


@pytest.mark.parametrize("goal", [None, 0, -1])
def test_missing_or_invalid_goal_is_not_closed(goal):
    data = snapshot(
        ring=[
            {
                "date": "2026-10-09",
                "moveKcal": 700,
                "moveGoalKcal": goal,
                "exerciseMin": 31,
                "exerciseGoalMin": 30,
                "standHours": 12,
                "standGoalHours": 12,
            }
        ]
    )
    assert data["values"]["rings_closed"] is None


def test_sleep_uses_latest_session_and_workout_retains_epoch_ms():
    data = snapshot(
        nights=[
            {"date": "2026-10-08", "end": 1, "asleepMinutes": 400},
            {"date": "2026-10-09", "end": 3, "asleepMinutes": 450},
            {"date": "2026-10-09", "end": 2, "asleepMinutes": 20},
        ],
        workouts=[
            {
                "uuid": "workout-1",
                "activityType": "running",
                "end": 1791580000000,
                "durationS": 1800,
                "distanceM": 5000,
            }
        ],
    )
    assert data["values"]["sleep"] == 450
    assert data["sleep_date"] == "2026-10-09"
    assert data["values"]["last_workout"] == 1791580000000
    assert data["values"]["workout_duration"] == 1800
    assert data["values"]["workout_energy"] is None


@pytest.mark.parametrize(
    "url",
    [
        "https://user:secret@example.test",
        "https://example.test?token=x",
        "https://example.test#x",
        "file:///tmp/health",
        "https://example.test:bad",
    ],
)
def test_invalid_urls(url):
    with pytest.raises(ValueError):
        normalize_url(url)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,error",
    [(401, InvalidAuth), (403, PulsHealthError), (302, PulsHealthError), (500, PulsHealthError)],
)
async def test_rejections_never_leak_token_or_follow_redirect(
    aiohttp_server, socket_enabled, status, error
):
    calls = []

    async def handler(request):
        calls.append(request)
        return web.Response(
            status=status, text="private-server-response", headers={"Location": "/forbidden"}
        )

    app = web.Application()
    app.router.add_get("/{path:.*}", handler)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as session:
        client = PulsHealthClient(session, str(server.make_url("/")), "private-token")
        with pytest.raises(error) as caught:
            await client.account()
        assert "private" not in str(caught.value)
        assert len(calls) == 1
        assert calls[0].headers["Authorization"] == "Bearer private-token"


@pytest.mark.asyncio
async def test_dst_account_calendar_and_explicit_scoping(aiohttp_server, socket_enabled):
    calls = []
    responses = {
        "/v1/users": {"users": [ACCOUNT], "default": USER},
        "/v1/catalog/types": {
            "types": [{"identifier": "HKQuantityTypeIdentifierStepCount", "aggregateRows": 1}]
        },
        "/v1/metrics/daily": {"metrics": []},
        "/v1/activity/summary": {"days": []},
        "/v1/sleep/daily": {"nights": []},
        "/v1/workouts": {"workouts": []},
    }

    async def handler(request):
        calls.append(request)
        return web.json_response(responses[request.path])

    app = web.Application()
    app.router.add_get("/{path:.*}", handler)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as session:
        client = PulsHealthClient(session, str(server.make_url("/")), "test-token", USER)
        data = await client.snapshot(datetime(2026, 11, 1, 12, tzinfo=timezone.utc))
        assert data["date"] == "2026-11-01"
        assert len(calls) == 6
        for request in calls:
            assert request.query["user"] == USER
            if request.path.endswith("/metrics/daily"):
                assert int(request.query["end"]) - int(request.query["start"]) == 25 * 3600 * 1000
                assert "start_date" not in request.query


@pytest.mark.asyncio
async def test_default_is_pinned_and_unknown_account_rejected(aiohttp_server, socket_enabled):
    payload = {"users": [ACCOUNT], "default": USER}

    async def handler(request):
        return web.json_response(payload)

    app = web.Application()
    app.router.add_get("/v1/users", handler)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as session:
        client = PulsHealthClient(session, str(server.make_url("/")), "test-token")
        await client.account()
        assert client.user_id == USER
        payload["users"] = []
        with pytest.raises(PulsHealthError):
            await client.account()
