# 002 — Owner statements interpreted while building (confirm via OPEN_QUESTIONS)

1. "Same dashboards and features" = both roles *see* every area; Staff *change* only Court Management (R14, Q34).
2. Staff may operate **any** court; a court's device merely opens on its court (Q32).
3. The Players page lists registered players **and typed names** (grouped case-insensitively); only the Admin can add a typed name to the directory (Q35).
4. A reservation **warns but never blocks** play (`409 BOOKING_WARNING` handshake) (Q33).
5. Staff can switch maintenance on/off and release courts (part of "status").

All five are implemented behind single points of change: the permission table in `packages/shared/src/permissions.ts` and the booking-warning check in `matches.ts#createMatch`.
