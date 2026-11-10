import time
import httpx
from typing import Optional, Dict, Any, List, Tuple
from config import SAMAD_BASE_URL, SAMAD_BASIC_AUTH, VERIFY_SSL
import database


class SamadAPIError(Exception):
    def __init__(self, message: str, error_code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class SamadClient:
    def __init__(
        self,
        telegram_id: Optional[int] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[float] = None,
    ):
        self.telegram_id = telegram_id
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.token_expires_at = token_expires_at or 0.0

        # Create async client
        self._client = httpx.AsyncClient(
            base_url=SAMAD_BASE_URL,
            verify=VERIFY_SSL,
            timeout=20.0,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    async def close(self):
        await self._client.aclose()

    @classmethod
    async def for_user(cls, telegram_id: int) -> Optional["SamadClient"]:
        """Creates a SamadClient instance loaded from database for a Telegram user."""
        user = await database.get_user(telegram_id)
        if not user or not user.get("access_token"):
            return None

        client = cls(
            telegram_id=telegram_id,
            access_token=user["access_token"],
            refresh_token=user["refresh_token"],
            token_expires_at=user["token_expires_at"],
        )
        return client

    async def _ensure_token_valid(self):
        """Refreshes access token if close to expiry."""
        # If expires in less than 2 minutes, refresh it
        if self.token_expires_at and (time.time() + 120 >= self.token_expires_at):
            if self.refresh_token:
                try:
                    await self.refresh_access_token()
                except Exception:
                    pass

    async def get_captcha(self) -> Dict[str, str]:
        """
        Requests a new captcha image and validation token from Samad.
        Endpoint: POST /rest/captcha
        """
        import uuid
        nonce = str(uuid.uuid4())
        headers = {
            "Authorization": SAMAD_BASIC_AUTH,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        response = await self._client.post(
            "/rest/captcha", json={"nonce": nonce}, headers=headers
        )
        data = response.json() if response.status_code == 200 else {}
        payload = data.get("payload", {}) if isinstance(data, dict) else {}
        if payload and payload.get("validation"):
            return {
                "nonce": nonce,
                "validation": payload["validation"],
                "image": payload.get("image", ""),
            }
        raise SamadAPIError("خطا در دریافت کد امنیتی (کپچا) از سامانه صمد")

    async def login(
        self,
        username: str,
        password: str,
        captcha_text: Optional[str] = None,
        validation: Optional[str] = None,
        nonce: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Logs in using password grant type with optional/required captcha.
        Endpoint: POST /oauth/token
        """
        headers = {
            "Authorization": SAMAD_BASIC_AUTH,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "username": username,
            "password": password,
            "grant_type": "password",
            "scope": "read write",
        }
        if captcha_text and validation and nonce:
            data["captchaText"] = captcha_text
            data["validation"] = validation
            data["nonce"] = nonce

        response = await self._client.post("/oauth/token", data=data, headers=headers)
        res_json = None
        try:
            res_json = response.json()
        except Exception:
            pass

        if response.status_code == 200 and isinstance(res_json, dict):
            token_data = res_json
            self.access_token = token_data.get("access_token")
            self.refresh_token = token_data.get("refresh_token")
            expires_in = token_data.get("expires_in", 43199)
            self.token_expires_at = time.time() + expires_in

            if self.telegram_id:
                await database.save_user_tokens(
                    telegram_id=self.telegram_id,
                    username=username,
                    password=password,
                    access_token=self.access_token,
                    refresh_token=self.refresh_token,
                    expires_in=expires_in,
                )
            return token_data
        elif isinstance(res_json, dict) and res_json.get("type") == "ERROR":
            msg = res_json.get("messageFa") or res_json.get("message") or "خطا در احراز هویت"
            raise SamadAPIError(msg, res_json.get("code"))
        elif response.status_code in (400, 401):
            raise SamadAPIError("نام کاربری یا رمز عبور یا کد امنیتی اشتباه است.")
        else:
            raise SamadAPIError(f"خطا در احراز هویت (کد {response.status_code})")

    async def refresh_access_token(self) -> Dict[str, Any]:
        """Refreshes the OAuth token using refresh_token."""
        if not self.refresh_token:
            raise SamadAPIError("توکن تجدید یافت نشد. لطفاً مجدداً لاگین کنید.")

        headers = {
            "Authorization": SAMAD_BASIC_AUTH,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
        }

        response = await self._client.post("/oauth/token", data=data, headers=headers)
        if response.status_code == 200:
            token_data = response.json()
            self.access_token = token_data.get("access_token")
            self.refresh_token = token_data.get("refresh_token", self.refresh_token)
            expires_in = token_data.get("expires_in", 43199)
            self.token_expires_at = time.time() + expires_in

            if self.telegram_id:
                user = await database.get_user(self.telegram_id)
                username = user.get("username", "") if user else ""
                await database.save_user_tokens(
                    telegram_id=self.telegram_id,
                    username=username,
                    access_token=self.access_token,
                    refresh_token=self.refresh_token,
                    expires_in=expires_in,
                )
            return token_data
        else:
            raise SamadAPIError("اعتبار نشست شما منقضی شده است. لطفاً مجدداً وارد شوید.")

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
    ) -> Any:
        """Sends authenticated request with auto-retry and auto-refresh."""
        await self._ensure_token_valid()

        headers = {}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        try:
            response = await self._client.request(
                method=method,
                url=path,
                params=params,
                json=json_body,
                headers=headers,
            )
        except httpx.RequestError as e:
            raise SamadAPIError(f"خطا در برقراری ارتباط با سرور صمد: {str(e)}")

        # Handle 401 Unauthorized -> try refresh once
        if response.status_code == 401 and self.refresh_token:
            try:
                await self.refresh_access_token()
                headers["Authorization"] = f"Bearer {self.access_token}"
                response = await self._client.request(
                    method=method,
                    url=path,
                    params=params,
                    json=json_body,
                    headers=headers,
                )
            except Exception:
                raise SamadAPIError("نشست شما منقضی شده است. لطفاً دستور /login را ارسال کنید.")

        try:
            res_json = response.json()
        except Exception:
            if response.status_code >= 400:
                raise SamadAPIError(f"خطا در سرور صمد (کد {response.status_code})")
            return None

        # Check Samad envelope
        if isinstance(res_json, dict):
            # Check for error type or success == False
            if res_json.get("type") == "ERROR" or res_json.get("success") is False:
                msg = (
                    res_json.get("messageFa")
                    or res_json.get("message")
                    or "عملیات با خطا مواجه شد."
                )
                raise SamadAPIError(msg, res_json.get("code") or res_json.get("errorCode"))

            # Return payload or data if envelope exists
            if "payload" in res_json:
                return res_json["payload"]
            if "data" in res_json:
                return res_json["data"]

        return res_json

    async def get_user_profile(self) -> Dict[str, Any]:
        """GET /rest/users/me"""
        data = await self._request("GET", "/rest/users/me")
        return data or {}

    async def get_nurture_profile(self) -> Dict[str, Any]:
        """GET /rest/users/nurture-profiles"""
        data = await self._request("GET", "/rest/users/nurture-profiles")
        return data or {}

    async def get_login_token(self) -> str:
        """GET /rest/users/me/login-token"""
        data = await self._request("GET", "/rest/users/me/login-token")
        if isinstance(data, dict):
            return data.get("loginToken", "")
        return str(data)

    async def get_available_selfs(self) -> List[Dict[str, Any]]:
        """GET /rest/reservations/selfs"""
        data = await self._request("GET", "/rest/reservations/selfs")
        if isinstance(data, list):
            return data
        return []

    async def get_reservable_programs(
        self, self_id: int, week_start_date: str
    ) -> Dict[str, Any]:
        """GET /rest/reservations/programs/v2?selfId={self_id}&weekStartDate={week_start_date}"""
        params = {"selfId": self_id, "weekStartDate": week_start_date}
        data = await self._request("GET", "/rest/reservations/programs/v2", params=params)
        return data or {}

    async def set_food_reservation(
        self,
        program_id: int,
        food_type_id: int,
        meal_type_id: int,
        selected: bool = True,
    ) -> str:
        """
        PUT /rest/reserves/{programId}/reserve
        selected=True for reserve, selected=False for cancel
        """
        body = {
            "foodTypeId": food_type_id,
            "mealTypeId": meal_type_id,
            "freeFoodSelected": False,
            "selected": selected,
            "selectedCount": 1 if selected else 0,
        }
        res = await self._request(
            "PUT", f"/rest/reserves/{program_id}/reserve", json_body=body
        )
        if isinstance(res, dict) and res.get("messageFa"):
            return res["messageFa"]
        return "رزرو غذا با موفقیت انجام شد." if selected else "رزرو غذا لغو گردید."

    async def get_reservation_info(self, week_start_date: str) -> Dict[str, Any]:
        """GET /rest/reserves?weekStartDate={week_start_date}"""
        params = {"weekStartDate": week_start_date}
        data = await self._request("GET", "/rest/reserves", params=params)
        return data or {}

    async def get_forget_code(
        self, reserve_id: int, daily_sale: bool = False
    ) -> Dict[str, Any]:
        """GET /rest/forget-card-codes/print?reserveId={reserve_id}&count=1&dailySale={daily_sale}"""
        params = {"reserveId": reserve_id, "count": 1, "dailySale": daily_sale}
        data = await self._request("GET", "/rest/forget-card-codes/print", params=params)
        return data or {}

    async def get_daily_sell_programs(self) -> List[Dict[str, Any]]:
        """GET /rest/daily-sell-programs"""
        data = await self._request("GET", "/rest/daily-sell-programs")
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and "items" in data:
            return data["items"]
        return []

    async def reserve_daily_sell(self, reserve_id: int) -> str:
        """PUT /rest/daily-sell-programs/{reserveId}/reserve-daily-sell"""
        res = await self._request(
            "PUT", f"/rest/daily-sell-programs/{reserve_id}/reserve-daily-sell"
        )
        if isinstance(res, dict) and res.get("messageFa"):
            return res["messageFa"]
        return "خرید روزانه با موفقیت انجام شد."
