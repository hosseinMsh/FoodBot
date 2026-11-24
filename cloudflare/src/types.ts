export interface Env {
  BOT_TOKEN: string;
  PLATFORM?: "telegram" | "bale" | string;
  BOT_API_ROOT?: string;
  SAMAD_BASE_URL?: string;
  SAMAD_BASIC_AUTH?: string;
  PAY_SHARIF_URL?: string;
  MINIAPP_URL?: string;
  DB: D1Database;
  KV: KVNamespace;
}

export interface User {
  telegram_id: number;
  username: string;
  password?: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  selected_self_id?: number;
  selected_self_name?: string;
  full_name?: string;
  auto_send_code?: number;
  auto_reserve_enabled?: number;
  auto_reserve_scope?: string;
  auto_reserve_days?: string;
  created_at?: number;
  updated_at?: number;
}

export interface FavoriteFood {
  id: number;
  telegram_id: number;
  food_name: string;
  created_at?: number;
}

export interface AutoReserveResultItem {
  programId: number;
  foodName: string;
  dayTranslated: string;
  dateJStr: string;
  mealTitle: string;
  selfName: string;
  price: number;
}

export interface LowCreditAlertItem {
  foodName: string;
  requiredToman: number;
  balanceToman: number;
  mealTitle: string;
  dayTitle: string;
}

export interface AutoReserveUserSummary {
  telegramId: number;
  reservedMeals: AutoReserveResultItem[];
  lowCreditAlerts: LowCreditAlertItem[];
  errors: string[];
}

export interface AutoReserveSummary {
  timestamp: number;
  usersProcessed: number;
  mealsReserved: number;
  summaries: AutoReserveUserSummary[];
}

export interface UserSession {
  step?: "WAITING_USERNAME" | "WAITING_PASSWORD" | "WAITING_CAPTCHA" | "WAITING_FAVORITE_NAME";
  tempUsername?: string;
  tempPassword?: string;
  captchaNonce?: string;
  captchaValidation?: string;
}

export interface DiningLocation {
  id: number;
  name: string;
  active?: boolean;
}

export interface FoodItem {
  programId: number;
  foodTypeId: number;
  mealTypeId: number;
  foodName: string;
  price: number;
  isReserved?: boolean;
  reserveRuleViolated?: boolean;
}

export interface DayProgram {
  date: string;
  dayTranslated: string;
  dateJStr: string;
  meals: {
    mealTypeId: number;
    mealTypeTitle: string;
    foods: FoodItem[];
  }[];
}
