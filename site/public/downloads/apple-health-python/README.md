# Apple Health Python example

All three included input CSVs are synthetic. No personal health records are
included. They follow the PulsHealth product API export headers. Use Python
3.10+, install requirements.txt, then run `python analyze.py --time-zone UTC`.
The default range is 2026-08-03 through 2026-08-30 (end exclusive 2026-08-31).
Expected: workouts=12; sleep_days=25; resting_hr_days=26; calendar_days=28.
Outputs: figures/three-charts.webp and figures/daily-summary.csv.
expected-daily-summary.csv is the checked synthetic output.

For personal data, use --input, --output, --start, --end, --time-zone and
--label. Match the time zone to the server's PULS_TIME_ZONE. These files must
be the product API workouts, sleep, and daily_metrics exports, NOT Apple's
XML or the different on-device aggregate CSV. Resting HR needs count/min.
The script refuses duplicate dates/UUIDs and unexpected resting HR units.
Zero workout records are not proof of complete data coverage or no exercise.
Missing sleep/heart-rate values remain missing. The script makes no network
requests; dependency installation downloads packages.

Tested with Python 3.12 and the dependency versions in requirements.txt.
Full walkthrough: https://pulshealth.com/blog/analyze-apple-health-with-python/
