# 001 — better-sqlite3 with embedded SQL migrations (no Drizzle)

**Status:** accepted (deviates from SYSTEM_ARCHITECTURE §1, which named Drizzle ORM).

**Context.** The schema relies on SQLite features an ORM does not express: partial unique indexes (one active match per court, one device per court), CHECK constraints (`terminated ⇒ winner IS NULL`), triggers (booking overlap) and `BEGIN IMMEDIATE` serialisation. The whole database layer is a few hundred lines of parameterised SQL.

**Decision.** Use `better-sqlite3` directly. Migrations are SQL strings in `apps/server/src/db/migrations.ts`, applied in order with `PRAGMA user_version`, preceded by a file-copy `pre_migration` backup. Everything the schema document specifies was validated by executing it in SQLite.

**Consequences.** One fewer runtime dependency and no ORM/DDL drift. Query results are cast to row interfaces by hand; the integration tests cover them.
