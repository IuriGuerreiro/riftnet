// WARN: labels are small fixed sets; never emails, ids or tokens.
pub const LOGINS: &str = "auth_logins_total";
pub const REGISTRATIONS: &str = "auth_registrations_total";
pub const REFRESHES: &str = "auth_refreshes_total";

pub fn login(result: &'static str) {
    metrics::counter!(LOGINS, "result" => result).increment(1);
}

pub fn registration(result: &'static str) {
    metrics::counter!(REGISTRATIONS, "result" => result).increment(1);
}

pub fn refresh(result: &'static str) {
    metrics::counter!(REFRESHES, "result" => result).increment(1);
}

pub fn duration(operation: &'static str, elapsed: std::time::Duration) {
    metrics::histogram!("auth_request_duration_seconds", "operation" => operation)
        .record(elapsed.as_secs_f64());
}
