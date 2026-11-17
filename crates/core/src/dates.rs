//! Civil-date helpers. Keeping these local avoids a chrono/time dependency for
//! the two things Cortex needs: parse `YYYY-MM-DD` and format a day number.

use std::time::{SystemTime, UNIX_EPOCH};

/// Days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + i64::from(m <= 2), m as u32, d as u32)
}

pub fn iso_date(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Parses the leading `YYYY-MM-DD` of a string (time suffixes are ignored).
pub fn parse_iso_date(value: &str) -> Option<i64> {
    let bytes = value.trim().as_bytes();
    if bytes.len() < 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let num = |slice: &[u8]| -> Option<i64> {
        if slice.iter().all(u8::is_ascii_digit) {
            std::str::from_utf8(slice).ok()?.parse().ok()
        } else {
            None
        }
    };
    let year = num(&bytes[0..4])?;
    let month = num(&bytes[5..7])? as u32;
    let day = num(&bytes[8..10])? as u32;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

pub fn from_unix_millis(ms: u64) -> i64 {
    (ms / 1000) as i64 / 86_400
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn today_days() -> i64 {
    from_unix_millis(now_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_known_dates() {
        for (y, m, d) in [(1970, 1, 1), (2000, 2, 29), (2026, 11, 16), (1999, 12, 31)] {
            let days = days_from_civil(y, m, d);
            assert_eq!(civil_from_days(days), (y, m, d));
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
    }

    #[test]
    fn parses_iso_prefixes() {
        assert_eq!(
            parse_iso_date("2026-11-16"),
            parse_iso_date("2026-11-16T10:22:00Z")
        );
        assert_eq!(
            parse_iso_date("2026-11-16"),
            Some(days_from_civil(2026, 11, 16))
        );
        assert!(parse_iso_date("16.11.2026").is_none());
        assert!(parse_iso_date("2026-13-01").is_none());
    }

    #[test]
    fn formats_iso() {
        assert_eq!(iso_date(days_from_civil(2024, 3, 7)), "2024-03-07");
    }
}
