import { Env, User } from "./types";
import * as db from "./db";

export class SamadError extends Error {
  errorCode?: string | number;
  constructor(message: string, errorCode?: string | number) {
    super(message);
    this.name = "SamadError";
    this.errorCode = errorCode;
  }
}

export class SamadClient {
  private baseUrl: string;
  private basicAuth: string;
  private env: Env;
  private user?: User;

  constructor(env: Env, user?: User) {
    this.env = env;
    this.user = user;
    this.baseUrl = (env.SAMAD_BASE_URL || "https://setad.dining.sharif.edu/").replace(/\/+$/, "") + "/";
    this.basicAuth = env.SAMAD_BASIC_AUTH || "Basic c2FtYWQtbW9iaWxlOnNhbWFkLW1vYmlsZS1zZWNyZXQ=";
  }

  static async forUser(env: Env, telegramId: number): Promise<SamadClient | null> {
    const user = await db.getUser(env.DB, telegramId);
    if (!user || !user.access_token) return null;
    return new SamadClient(env, user);
  }

  private async ensureTokenValid(): Promise<void> {
    if (!this.user || !this.user.refresh_token) return;
    const now = Date.now() / 1000;
    if (this.user.token_expires_at && now + 120 >= this.user.token_expires_at) {
      try {
        await this.refreshAccessToken();
      } catch {
        // Token refresh failed, will try next request
      }
    }
  }

  async getCaptcha(): Promise<{ nonce: string; validation: string; imageBase64: string }> {
    const nonce = crypto.randomUUID();
    const url = new URL("rest/captcha", this.baseUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: this.basicAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ nonce }),
    });

    const data: any = await res.json().catch(() => null);
    if (data && data.payload) {
      return {
        nonce,
        validation: data.payload.validation,
        imageBase64: data.payload.image,
      };
    }
    throw new SamadError("خطا در دریافت کد امنیتی (کپچا)");
  }

  async login(
    username: string,
    password: string,
    captchaText?: string,
    validation?: string,
    nonce?: string
  ): Promise<any> {
    const url = new URL("oauth/token", this.baseUrl);
    const body = new URLSearchParams({
      username,
      password,
      grant_type: "password",
      scope: "read write",
    });

    if (captchaText && validation && nonce) {
      body.append("captchaText", captchaText);
      body.append("validation", validation);
      body.append("nonce", nonce);
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: this.basicAuth,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    const resJson: any = await res.json().catch(() => null);

    if (res.status === 200 && resJson) {
      const accessToken = resJson.access_token;
      const refreshToken = resJson.refresh_token;
      const expiresIn = resJson.expires_in || 43199;

      if (this.user) {
        this.user.access_token = accessToken;
        this.user.refresh_token = refreshToken;
        this.user.token_expires_at = Date.now() / 1000 + expiresIn;
        await db.saveUserTokens(
          this.env.DB,
          this.user.telegram_id,
          username,
          accessToken,
          refreshToken,
          expiresIn,
          password
        );
      }
      return resJson;
    }

    if (resJson && resJson.type === "ERROR") {
      const msg = resJson.messageFa || resJson.message || "اطلاعات ورود نامعتبر است.";
      throw new SamadError(msg, resJson.code);
    }

    if (res.status === 400 || res.status === 401) {
      throw new SamadError("نام کاربری یا رمز عبور یا کد امنیتی اشتباه است.");
    }

    throw new SamadError(`خطا در احراز هویت با سامانه صمد (کد ${res.status})`);
  }

  async refreshAccessToken(): Promise<any> {
    if (!this.user || !this.user.refresh_token) {
      throw new SamadError("توکن تجدید یافت نشد. لطفاً مجدداً وارد شوید.");
    }

    const url = new URL("oauth/token", this.baseUrl);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.user.refresh_token,
    });

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: this.basicAuth,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (res.status === 200) {
      const tokenData: any = await res.json();
      this.user.access_token = tokenData.access_token;
      this.user.refresh_token = tokenData.refresh_token || this.user.refresh_token;
      const expiresIn = tokenData.expires_in || 43199;
      this.user.token_expires_at = Date.now() / 1000 + expiresIn;

      await db.saveUserTokens(
        this.env.DB,
        this.user.telegram_id,
        this.user.username,
        this.user.access_token,
        this.user.refresh_token,
        expiresIn
      );
      return tokenData;
    } else {
      throw new SamadError("نشست شما منقضی شده است. لطفاً مجدداً با /login وارد شوید.");
    }
  }

  private async request(
    method: string,
    path: string,
    params?: Record<string, any>,
    jsonBody?: any
  ): Promise<any> {
    await this.ensureTokenValid();

    const url = new URL(path.replace(/^\/+/, ""), this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (this.user?.access_token) {
      headers["Authorization"] = `Bearer ${this.user.access_token}`;
    }

    let res = await fetch(url.toString(), {
      method,
      headers,
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });

    // Handle 401 Unauthorized -> auto refresh token
    if (res.status === 401 && this.user?.refresh_token) {
      try {
        await this.refreshAccessToken();
        headers["Authorization"] = `Bearer ${this.user.access_token}`;
        res = await fetch(url.toString(), {
          method,
          headers,
          body: jsonBody ? JSON.stringify(jsonBody) : undefined,
        });
      } catch {
        throw new SamadError("نشست شما منقضی شده است. لطفاً دستور /login را ارسال کنید.");
      }
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      if (res.status >= 400) {
        throw new SamadError(`خطای سرور سامانه صمد (کد ${res.status})`);
      }
      return null;
    }

    if (data && typeof data === "object") {
      if (data.type === "ERROR" || data.success === false) {
        const msg = data.messageFa || data.message || "عملیات با خطا مواجه شد.";
        throw new SamadError(msg, data.code || data.errorCode);
      }
      if ("payload" in data) return data.payload;
      if ("data" in data) return data.data;
    }

    return data;
  }

  async getUserProfile(): Promise<any> {
    return (await this.request("GET", "rest/users/me")) || {};
  }

  async getNurtureProfile(): Promise<any> {
    return (await this.request("GET", "rest/users/nurture-profiles")) || {};
  }

  async getLoginToken(): Promise<string> {
    const data = await this.request("GET", "rest/users/me/login-token");
    if (data && typeof data === "object") {
      return data.loginToken || "";
    }
    return String(data || "");
  }

  async getAvailableSelfs(): Promise<any[]> {
    const data = await this.request("GET", "rest/reservations/selfs");
    return Array.isArray(data) ? data : [];
  }

  async getReservablePrograms(selfId: number, weekStartDate: string): Promise<any> {
    return (
      (await this.request("GET", "rest/reservations/programs/v2", {
        selfId,
        weekStartDate,
      })) || {}
    );
  }

  async setFoodReservation(
    programId: number,
    foodTypeId: number,
    mealTypeId: number,
    selected: boolean = true
  ): Promise<string> {
    const body = {
      foodTypeId,
      mealTypeId,
      freeFoodSelected: false,
      selected,
      selectedCount: selected ? 1 : 0,
    };
    const res = await this.request("PUT", `rest/reserves/${programId}/reserve`, undefined, body);
    if (res && res.messageFa) return res.messageFa;
    return selected ? "رزرو غذا با موفقیت انجام شد." : "رزرو غذا لغو گردید.";
  }

  async getReservationInfo(weekStartDate: string): Promise<any> {
    return (await this.request("GET", "rest/reserves", { weekStartDate })) || {};
  }

  async getForgetCode(reserveId: number, dailySale: boolean = false): Promise<any> {
    return (
      (await this.request("GET", "rest/forget-card-codes/print", {
        reserveId,
        count: 1,
        dailySale,
      })) || {}
    );
  }

  async getDailySellPrograms(): Promise<any[]> {
    const data = await this.request("GET", "rest/daily-sell-programs");
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  async reserveDailySell(reserveId: number): Promise<string> {
    const res = await this.request("PUT", `rest/daily-sell-programs/${reserveId}/reserve-daily-sell`);
    if (res && res.messageFa) return res.messageFa;
    return "خرید روزانه با موفقیت انجام شد.";
  }
}
