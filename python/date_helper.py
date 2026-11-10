"""
Helper functions for Iranian Academic Calendar (Samad) and Persian dates.
The Samad system week starts on Saturday at 00:00:00.
"""

from datetime import datetime, timedelta
from typing import List, Tuple
import jdatetime

PERSIAN_WEEKDAYS = {
    0: "دوشنبه",
    1: "سه‌شنبه",
    2: "چهارشنبه",
    3: "پنجشنبه",
    4: "جمعه",
    5: "شنبه",
    6: "یکشنبه",
}


ENGLISH_TO_PERSIAN_DAYS = {
    "saturday": "شنبه",
    "sunday": "یکشنبه",
    "monday": "دوشنبه",
    "tuesday": "سه‌شنبه",
    "wednesday": "چهارشنبه",
    "thursday": "پنجشنبه",
    "friday": "جمعه",
}


def to_persian_day_name(name: str) -> str:
    """Translates day name to Persian if in English."""
    if not name:
        return ""
    clean = name.strip().lower()
    return ENGLISH_TO_PERSIAN_DAYS.get(clean, name)


def get_persian_weekday_name(dt: datetime) -> str:
    """Returns the Persian weekday name for a Gregorian datetime."""
    return PERSIAN_WEEKDAYS.get(dt.weekday(), "")


def to_jalali_str(dt: datetime, include_time: bool = False) -> str:
    """Converts a Gregorian datetime to Jalali string (e.g. 1403/08/15)."""
    jdt = jdatetime.datetime.fromgregorian(datetime=dt)
    if include_time:
        return jdt.strftime("%Y/%m/%d %H:%M")
    return jdt.strftime("%Y/%m/%d")


def parse_date(date_str: str) -> datetime:
    """Parses date string in 'yyyy-MM-dd' or 'yyyy-MM-dd HH:mm:ss' format."""
    clean = date_str.strip()
    if len(clean) == 10:
        return datetime.strptime(clean, "%Y-%m-%d")
    return datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")


def get_week_saturday(reference_date: datetime = None) -> datetime:
    """
    Returns the Saturday 00:00:00 of the week that includes reference_date.
    In Python: Monday is 0, ..., Saturday is 5, Sunday is 6.
    Days since Saturday: (weekday - 5) % 7
    """
    now = reference_date or datetime.now()
    days_since_sat = (now.weekday() - 5) % 7
    saturday = now - timedelta(days=days_since_sat)
    return saturday.replace(hour=0, minute=0, second=0, microsecond=0)


def get_current_week_saturday_str(reference_date: datetime = None) -> str:
    """Returns current week's starting Saturday formatted as 'yyyy-MM-dd 00:00:00'."""
    sat = get_week_saturday(reference_date)
    return sat.strftime("%Y-%m-%d 00:00:00")


def get_next_week_saturday_str(reference_date: datetime = None) -> str:
    """Returns NEXT week's starting Saturday formatted as 'yyyy-MM-dd 00:00:00'."""
    sat = get_week_saturday(reference_date) + timedelta(days=7)
    return sat.strftime("%Y-%m-%d 00:00:00")


def normalize_weekly_programs(prog_data: dict) -> list:
    """
    Normalizes reservable weekly programs from Samad API (which returns either
    'selfWeekPrograms' or 'days') into a clean, standard list of days.
    """
    if not isinstance(prog_data, dict):
        return []

    days = []
    if "selfWeekPrograms" in prog_data:
        for day_items in prog_data["selfWeekPrograms"]:
            if not day_items:
                continue
            first = day_items[0]
            date_str = first.get("date", "")
            day_name = to_persian_day_name(first.get("dayTranslated", ""))
            meals_map = {}
            for item in day_items:
                m_id = item.get("mealTypeId", 1)
                m_title = item.get("mealTypeName") or item.get("mealTypeTitle", "ناهار")
                if m_id not in meals_map:
                    meals_map[m_id] = {
                        "mealTypeId": m_id,
                        "mealTypeTitle": m_title,
                        "foods": [],
                    }
                meals_map[m_id]["foods"].append(item)
            days.append(
                {
                    "date": date_str,
                    "dayTranslated": day_name,
                    "dateJStr": to_jalali_str(parse_date(date_str)),
                    "meals": list(meals_map.values()),
                }
            )
    elif "days" in prog_data:
        days = prog_data["days"]

    return days


def format_toman(rials: int) -> str:
    """Formats amount in Rials and Tomans for readable display."""
    if rials is None:
        return "۰ تومان"
    is_negative = rials < 0
    abs_rials = abs(rials)
    toman = abs_rials // 10
    rials_str = f"{abs_rials:,}"
    toman_str = f"{toman:,}"
    if is_negative:
        return f"-{toman_str} تومان ({rials_str}- ریال بدهی)"
    return f"{toman_str} تومان ({rials_str} ریال)"
