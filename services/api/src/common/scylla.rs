//! ScyllaDB connection + schema. Holds DM data on the hub
//! (see docs/architecture/messaging.md).

use std::sync::Arc;

use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;

/// Schema files in `scylla/`, applied in order on every start (all IF NOT EXISTS).
const SCHEMA: &[&str] = &[include_str!("../../scylla/001_conversations.cql")];

/// Connects, creates the keyspace if needed, and applies the schema.
/// Tablets are off: in Scylla 2025 they don't support lightweight
/// transactions (`IF NOT EXISTS`), which we need for DMs and message seq.
/// `replication` is how many copies of each row Scylla keeps (1 in dev, 3 in prod).
pub async fn connect(
    nodes: &[String],
    keyspace: &str,
    replication: u8,
) -> anyhow::Result<Arc<Session>> {
    let session = SessionBuilder::new().known_nodes(nodes).build().await?;

    session
        .query_unpaged(
            format!(
                "CREATE KEYSPACE IF NOT EXISTS {keyspace} WITH replication = \
                 {{'class': 'NetworkTopologyStrategy', 'replication_factor': {replication}}} \
                 AND tablets = {{'enabled': false}}"
            ),
            (),
        )
        .await?;
    session.use_keyspace(keyspace, false).await?;

    for file in SCHEMA {
        for statement in statements(file) {
            session.query_unpaged(statement, ()).await?;
        }
    }
    Ok(Arc::new(session))
}

/// Splits a .cql file into statements, skipping `--` comments.
fn statements(file: &str) -> Vec<String> {
    let without_comments: String = file
        .lines()
        .map(|l| l.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    without_comments
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn splits_statements_and_drops_comments() {
        let s = super::statements("-- hi\nCREATE A (x int); -- trailing\n\nCREATE B;\n");
        assert_eq!(s, vec!["CREATE A (x int)", "CREATE B"]);
    }
}
