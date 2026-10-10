"""Public clients use PKCE and Home Assistant's browser callback and token store."""

import aiohttp
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.config_entry_oauth2_flow import (
    MY_AUTH_CALLBACK_PATH,
    LocalOAuth2ImplementationWithPkce,
    OAuth2TokenRequestConnectionError,
    OAuth2TokenRequestError,
    OAuth2TokenRequestReauthError,
    OAuth2TokenRequestTransientError,
)

from .const import DOMAIN

DEFAULT_ISSUER = "https://app.pulshealth.com"


class PulsHealthOAuth(LocalOAuth2ImplementationWithPkce):
    """No client secret; each HA installation registers its own public client."""

    def __init__(self, hass, issuer, client_id):
        self.issuer = issuer
        super().__init__(
            hass,
            DOMAIN,
            client_id,
            f"{issuer}/oauth/authorize",
            f"{issuer}/oauth/token",
        )

    @property
    def name(self):
        return "PulsHealth"

    @property
    def redirect_uri(self):
        return MY_AUTH_CALLBACK_PATH

    @property
    def extra_authorize_data(self):
        return {
            **super().extra_authorize_data,
            "scope": "health:read",
            "resource": f"{self.issuer}/api/health",
        }

    @property
    def extra_token_resolve_data(self):
        return {
            **super().extra_token_resolve_data,
            "resource": f"{self.issuer}/api/health",
        }

    async def _token_request(self, data):
        data = {**data, "client_id": self.client_id}
        try:
            async with async_get_clientsession(self.hass).post(
                self.token_url,
                data=data,
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                if response.status == 429 or response.status >= 500:
                    raise OAuth2TokenRequestTransientError(
                        domain=DOMAIN,
                        request_info=response.request_info,
                        status=response.status,
                    )
                if 400 <= response.status < 500:
                    raise OAuth2TokenRequestReauthError(
                        domain=DOMAIN,
                        request_info=response.request_info,
                        status=response.status,
                    )
                if response.status != 200:
                    raise OAuth2TokenRequestConnectionError(domain=DOMAIN)
                token = await response.json()
                if (
                    not isinstance(token, dict)
                    or not isinstance(token.get("access_token"), str)
                    or not token.get("access_token")
                    or not isinstance(token.get("refresh_token"), str)
                    or not token.get("refresh_token")
                    or token.get("token_type", "").lower() != "bearer"
                    or not isinstance(token.get("expires_in"), int)
                    or token["expires_in"] <= 0
                ):
                    raise OAuth2TokenRequestConnectionError(domain=DOMAIN)
                return token
        except (OAuth2TokenRequestError, OAuth2TokenRequestConnectionError):
            raise
        except (aiohttp.ClientError, TimeoutError, ValueError, AttributeError) as err:
            raise OAuth2TokenRequestConnectionError(domain=DOMAIN) from err
