# Home Assistant integration moved

The integration, runtime tests, HACS metadata and releases now live in
[**PulsHealth/home-assistant**](https://github.com/PulsHealth/home-assistant).

Install that repository through HACS as an Integration, or follow its manual
installation instructions. Existing `pulshealth` entries, credentials and entity
IDs are unchanged. Do not delete or re-pair your Devices & services entry.
See the new README’s migration section before changing an existing HACS install.

The public API and OAuth server remain in this repository. The integration
continues to consume those read-only interfaces.
