use protocol::v1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Offline,
    Online,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Change {
    pub before: Status,
    pub after: Status,
}

impl Change {
    pub fn changed(&self) -> bool {
        self.before != self.after
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Conn {
    pub expires_at: i64,
    pub idle: bool,
}

pub fn status_of(conns: impl IntoIterator<Item = Conn>, now: i64) -> Status {
    let mut any = false;
    for conn in conns {
        if conn.expires_at <= now {
            continue;
        }
        if !conn.idle {
            return Status::Online;
        }
        any = true;
    }
    if any { Status::Idle } else { Status::Offline }
}

impl From<Status> for v1::PresenceStatus {
    fn from(status: Status) -> Self {
        match status {
            Status::Offline => Self::Offline,
            Status::Online => Self::Online,
            Status::Idle => Self::Idle,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(expires_at: i64, idle: bool) -> Conn {
        Conn { expires_at, idle }
    }

    #[test]
    fn status_rules() {
        assert_eq!(status_of([], 10), Status::Offline);
        assert_eq!(status_of([conn(5, false)], 10), Status::Offline);
        assert_eq!(status_of([conn(20, true)], 10), Status::Idle);
        assert_eq!(
            status_of([conn(20, true), conn(20, false)], 10),
            Status::Online
        );
        assert_eq!(
            status_of([conn(20, true), conn(5, false)], 10),
            Status::Idle
        );
    }
}
