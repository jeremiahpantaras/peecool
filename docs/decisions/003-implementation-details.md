# 003 — Details decided during implementation

- **Schema additions** beyond DATABASE_SCHEMA.md: `users.last_failed_at` (15-minute lockout window), `matches.ended_by_user_id`, `match_events.at` (event time, equal to `created_at`), and `create_requests(user_id, client_request_id, match_id, created_at)` for `clientRequestId` idempotency of match creation.
- **Static web app is public**; only `/api/*` and `/internal/*` are protected (found by the browser tests, regression-tested in `static.test.ts`).
- **Unknown `/api` paths return 404** (not 403) even when signed in.
- **Recovery mode**: if the database file is unreadable or fails `quick_check`, the service starts anyway; only `/api/v1/health` and backup list/restore (from the Master PC's loopback address) work until a backup is restored. The damaged file is kept as `pickle.corrupt-<timestamp>.db`.
- **Score panels are sized with container-query units** so both teams, both rally buttons and the controls always fit without scrolling on any screen from a 360 px phone to a tablet (found by the phone-viewport browser test).
- **Double-tap guard** (600 ms per rally button) is deliberate: a second tap inside the window is ignored.
- **Times follow the browser locale** (12 h or 24 h); dates and operating hours use the facility time zone sent by the server.
