-- Group DMs (3-5 people) reuse the conversations tables; they only add a name.
--
-- Scylla has no `ADD IF NOT EXISTS`: on later starts this fails with
-- "conflicts with an existing column", which the schema runner treats as done.
ALTER TABLE conversations ADD name text;
