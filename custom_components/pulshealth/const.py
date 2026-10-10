"""PulsHealth integration constants."""

DOMAIN = "pulshealth"
CONF_USER_ID = "user_id"
DEFAULT_INTERVAL = 300
DAILY_TYPES = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "walking_running_distance",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_energy",
}
