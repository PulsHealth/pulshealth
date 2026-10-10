"""Read-only client for the PulsHealth product API; no database access."""

from datetime import UTC, datetime, time, timedelta
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import aiohttp
from homeassistant.helpers.config_entry_oauth2_flow import (
    OAuth2TokenRequestConnectionError,
    OAuth2TokenRequestError,
    OAuth2TokenRequestReauthError,
)

from .const import DAILY_TYPES


class PulsHealthError(Exception):
    """Connection, protocol, or account selection failure."""


class InvalidAuth(PulsHealthError):
    """API token rejected."""


def normalize_url(value: str) -> str:
    """Reject credentials, query strings, fragments, and unsupported schemes."""
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Use an HTTP(S) product API base URL")
    _ = parsed.port  # Validate the port, too.
    return value


def normalize_user(value: str) -> str:
    """Canonical account UUID; an empty input selects the server default."""
    return str(UUID(value.strip())) if value.strip() else ""


class PulsHealthClient:
    """Keep authorization on the configured origin, including behind a proxy."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        url: str,
        token: str,
        user_id: str = "",
        oauth_session=None,
    ) -> None:
        self.oauth_session = oauth_session
        self.session = session
        self.url = normalize_url(url)
        self._token = token
        self.user_id = normalize_user(user_id)

    async def get(self, path: str, **params) -> dict:
        """GET one endpoint. Never follow an authenticated redirect."""
        if self.oauth_session:
            try:
                await self.oauth_session.async_ensure_token_valid()
                self._token = self.oauth_session.token["access_token"]
            except OAuth2TokenRequestReauthError as err:
                raise InvalidAuth("Authorization expired or revoked") from err
            except (OAuth2TokenRequestError, OAuth2TokenRequestConnectionError) as err:
                raise PulsHealthError("Unable to refresh authorization") from err
        if self.user_id:
            params["user"] = self.user_id
        try:
            async with self.session.get(
                f"{self.url}{path}",
                params=params,
                headers={"Authorization": f"Bearer {self._token}"},
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                if response.status == 401:
                    raise InvalidAuth("Product API token rejected")
                if response.status == 403:
                    raise PulsHealthError("Account not allowed by this API deployment")
                if response.status != 200:
                    raise PulsHealthError(
                        f"Product API returned HTTP {response.status}"
                    )
                data = await response.json()
                if not isinstance(data, dict):
                    raise PulsHealthError("Invalid product API response")
                return data
        except (TimeoutError, aiohttp.ClientError, ValueError) as err:
            # Do not include server response bodies, URLs, or bearer strings.
            raise PulsHealthError("Unable to read the product API") from err

    async def account(self) -> dict:
        """Resolve and pin one account, rather than following a changing default."""
        payload = await self.get("/v1/users")
        selected = self.user_id or payload.get("default")
        for user in payload.get("users", []):
            if user.get("userID") == selected:
                try:
                    self.user_id = normalize_user(selected)
                    ZoneInfo(user["timeZone"])
                except (ValueError, KeyError, ZoneInfoNotFoundError) as err:
                    raise PulsHealthError("Invalid account calendar") from err
                return user
        raise PulsHealthError("Selected account was not returned by the API")

    async def snapshot(self, now: datetime | None = None) -> dict:
        """Fetch a bounded snapshot in the selected account's reporting calendar."""
        user = await self.account()
        zone = ZoneInfo(user["timeZone"])
        today = (now or datetime.now(UTC)).astimezone(zone).date()
        start = datetime.combine(today, time.min, zone)
        end = datetime.combine(today + timedelta(days=1), time.min, zone)
        window = {
            "start": int(start.timestamp() * 1000),
            "end": int(end.timestamp() * 1000),
        }
        catalog = await self.get("/v1/catalog/types")
        types = [
            row["identifier"]
            for row in catalog["types"]
            if row["identifier"] in DAILY_TYPES and row.get("aggregateRows", 0) > 0
        ]
        metrics = (
            await self.get("/v1/metrics/daily", types=",".join(types), **window)
            if types
            else {"metrics": []}
        )
        rings = await self.get("/v1/activity/summary", **window)
        sleep = await self.get(
            "/v1/sleep/daily",
            start=int((start - timedelta(days=7)).timestamp() * 1000),
            end=window["end"],
        )
        workouts = await self.get("/v1/workouts", limit=1)
        return project_snapshot(
            today.isoformat(), user, metrics, rings, sleep, workouts
        )


def project_snapshot(
    today: str, user: dict, metrics: dict, rings: dict, sleep: dict, workouts: dict
) -> dict:
    """Preserve nulls, canonical units, and dates; never sum raw samples."""
    values = {key: None for key in DAILY_TYPES.values()}
    for row in metrics["metrics"]:
        key = DAILY_TYPES.get(row["identifier"])
        if key:
            values[key] = next(
                (day["value"] for day in row["days"] if day["date"] == today), None
            )
    ring = next((day for day in rings["days"] if day["date"] == today), {})
    for field, key in (
        ("moveKcal", "move_energy"),
        ("moveGoalKcal", "move_energy_goal"),
        ("exerciseMin", "exercise"),
        ("exerciseGoalMin", "exercise_goal"),
        ("standHours", "stand"),
        ("standGoalHours", "stand_goal"),
        ("moveTimeMin", "move_time"),
        ("moveTimeGoalMin", "move_time_goal"),
    ):
        values[key] = ring.get(field)
    move_fields = (
        ("moveTimeMin", "moveTimeGoalMin")
        if ring.get("moveMode") == 2
        else ("moveKcal", "moveGoalKcal")
    )
    checks = [
        ring.get(move_fields[0]),
        ring.get(move_fields[1]),
        ring.get("exerciseMin"),
        ring.get("exerciseGoalMin"),
        ring.get("standHours"),
        ring.get("standGoalHours"),
    ]
    values["rings_closed"] = (
        None
        if any(v is None for v in checks) or any(checks[i] <= 0 for i in (1, 3, 5))
        else all(checks[i] >= checks[i + 1] for i in (0, 2, 4))
    )
    nights = [n for n in sleep["nights"] if n["date"] <= today]
    night = max(nights, key=lambda n: n["end"], default={})
    values["sleep"] = night.get("asleepMinutes")
    workout = next(iter(workouts["workouts"]), {})
    values["last_workout"] = workout.get("end")
    values["workout_duration"] = workout.get("durationS")
    values["workout_distance"] = workout.get("distanceM")
    values["workout_energy"] = workout.get("energyKcal")
    values["last_sync"] = user.get("lastSync")
    return {
        "values": values,
        "date": today,
        "time_zone": user["timeZone"],
        "sleep_date": night.get("date"),
        "workout": {
            key: workout.get(key) for key in ("uuid", "activityType", "start", "end")
        },
    }
