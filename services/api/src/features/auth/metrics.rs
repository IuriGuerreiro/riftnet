//! Auth counters. Labels are small fixed sets: never emails, ids or tokens.

pub const LOGINS: &str = "auth_logins_total";
pub const REGISTRATIONS: &str = "auth_registrations_total";
pub const REFRESHES: &str = "auth_refreshes_total";

/// `result`: `ok`, `failed` (wrong email/password) or `error`.
pub fn login(result: &'static str) {
    metrics::counter!(LOGINS, "result" => result).increment(1);
}

/// `result`: `ok`, `rejected` (bad input, email taken) or `error`.
pub fn registration(result: &'static str) {
    metrics::counter!(REGISTRATIONS, "result" => result).increment(1);
}

/// `result`: `ok`, `superseded` (two tabs raced), `reused` (likely theft,
/// device revoked), `revoked`, `expired`, `invalid`.
pub fn refresh(result: &'static str) {
    metrics::counter!(REFRESHES, "result" => result).increment(1);
}
