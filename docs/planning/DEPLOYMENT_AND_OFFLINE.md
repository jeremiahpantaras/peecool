# Deployment (Windows 11), Network, Offline Operation, Backup and Recovery

> Revision 3 — the owner confirmed: Master PC = **Windows 11** desktop or laptop on **wired Ethernet** with a **UPS**, **fixed local IP**; each court has a **phone or tablet** (called "Court 1", "Court 2", …) on a **staff-only Wi-Fi**, running the same app and login as every other device; up to **24 courts**; **no internet required**. This document is optimized for exactly that environment. macOS/Linux are development-only and not packaged.
> Example addresses below use `192.168.10.0/24`; substitute the facility's real subnet. Commands are run in **PowerShell as Administrator** and are meant to be wrapped in the installer's `setup-master.ps1` script (roadmap Phase 13); nothing here is application code.

## 1. Deployment model (summary)

- **Master PC** runs the *Pickle Scoring Service*: a bundled Node.js 24 runtime + the built app, registered as a **Windows service** (WinSW) that starts at boot (no user needs to log in), restarts on failure, and serves the API, Socket.IO and the web app on one port (default **8080**). The Master PC is only the *host*: the same app also runs in a browser on it, but it is no different from any other device.
- **Everyone — Admin and Staff, on every device** — opens the **same URL**, `http://192.168.10.10:8080` (on the Master PC itself `http://localhost:8080`), and **signs in with their own username and password**. The role (Admin or Staff) decides what they can change. Optional hardening: `adminLoginMasterPcOnly` accepts Admin logins only from the Master PC (FR-AUTH-10).
- **Each court's phone/tablet** opens the same URL, ideally in kiosk or guided-access mode, a staff member signs in, and chooses **"Use this device for Court N"**. From then on the device is "Court N" and reopens on that court after refreshes, reboots and network drops. There is **no pairing and no approval step**.
- **No internet** is required at any time after installation (no CDN, fonts, telemetry, update checks or licence checks).

## 2. Master PC requirements and Windows 11 preparation

| Item | Requirement |
|------|------------|
| OS | Windows 11 (Home or Pro), 64-bit x64, current cumulative updates installed **before** go-live (Q31 asks whether the PC is x64 or ARM) |
| Hardware | 4 cores, 8 GB RAM, SSD with ≥ 10 GB free; desktop preferred, laptop acceptable (see lid setting) |
| Network | **Wired Ethernet** to the facility switch (owner-confirmed); never Wi-Fi |
| Power | **UPS** (owner-confirmed). Size for the PC + switch + router/AP controller for ≥ 15 min; use a USB-connected UPS so Windows can shut down cleanly |
| Account | Create a local **standard** user for staff browser use if desired; the service itself runs as `NT AUTHORITY\LocalService` and needs no interactive login |

### 2.1 Power and availability hardening (run once, PowerShell as Administrator)

| Setting | Command / action | Why |
|---------|------------------|-----|
| Never sleep on AC | `powercfg /change standby-timeout-ac 0` | A sleeping PC drops every court |
| Disable hibernate and Fast Startup | `powercfg /hibernate off` | Fast Startup keeps a hibernated kernel across "shutdown" and can leave network/service state stale |
| Screen off is fine | `powercfg /change monitor-timeout-ac 15` | Does not affect the service |
| Laptop: closing the lid does nothing on AC | `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0` then `powercfg /setactive SCHEME_CURRENT` | |
| UPS on battery → shut down cleanly | `powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATACTIONCRIT 3` then `powercfg /setactive SCHEME_CURRENT` (3 = shut down), plus the UPS vendor's software if the UPS does not appear as a battery | Controlled shutdown beats a dead battery |
| NIC never powers down | `Disable-NetAdapterPowerManagement -Name "Ethernet"` and untick "Allow the computer to turn off this device to save power" in the adapter's Device Manager Power Management tab | |
| Windows Update restarts | Settings → Windows Update → Advanced options → **Active hours** set to the longest allowed window covering opening hours (max 18 h), and "Notify me when a restart is required" | Updates may only restart outside play |
| Auto-start after power loss | In BIOS/UEFI set **"Restore on AC power loss = Power On"** | So the PC and service return by themselves after an outage |
| Time zone | Set to the facility's zone (Settings → Time & language) | Reports and daily rollover use local time (A8) |
| Defender | Allow the service: `Add-MpPreference -ExclusionPath "C:\ProgramData\PickleScoring"` (optional; do not exclude the program folder) | Real-time scanning of the DB file can add latency |

## 3. Local IP configuration (fixed address)

The Master PC must keep the same address forever: a browser's session cookie and saved shortcut are bound to the URL's origin, so a changed IP forces every phone/tablet to open the new URL and sign in again (§9). Choose one of:

**Option A (recommended): DHCP reservation on the router** — bind the PC's Ethernet MAC to `192.168.10.10`; leave the PC on automatic (DHCP). Survives Windows re-installs and NIC changes if the MAC is updated.

**Option B: static address on the PC**, *outside* the router's DHCP pool (e.g. pool `.100–.200`, Master `.10`):
```
Set-NetIPInterface -InterfaceAlias "Ethernet" -Dhcp Disabled
New-NetIPAddress   -InterfaceAlias "Ethernet" -IPAddress 192.168.10.10 -PrefixLength 24 -DefaultGateway 192.168.10.1
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses 192.168.10.1
```
(The gateway/DNS entries keep Windows from labelling the network "Unidentified"; they do not need an internet connection to work.)

Verify: `Get-NetIPAddress -InterfaceAlias Ethernet` and, from a phone's browser on the staff Wi-Fi, `http://192.168.10.10:8080/api/v1/health`. The installer also runs `pickle-scoring print-urls`, which prints every URL and the QR code for setting up phones/tablets.

## 4. Windows Firewall

The installer creates **one inbound rule**, scoped to the local subnet:

```
New-NetFirewallRule -DisplayName "Pickle Scoring (TCP 8080)" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8080 -RemoteAddress LocalSubnet -Profile Any `
  -Program "C:\Program Files\PickleScoring\runtime\node.exe"
```

- **Why `-Profile Any` with `-RemoteAddress LocalSubnet`:** with no internet, Windows sometimes classifies a wired network as *Public* or *Unidentified* after a NIC reset, which would silently block a Private-only rule. Restricting by **local subnet** (instead of by profile) keeps the port reachable from the staff LAN only, whatever Windows decides to call the network. Also set the profile to Private for hygiene: `Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private`.
- No other inbound rule is needed. **Do not** forward port 8080 on the router, and do not expose it to the guest network.
- Outbound: nothing required (the service makes no outbound connections).
- Verification checklist: `Get-NetFirewallRule -DisplayName "Pickle Scoring*" | Get-NetFirewallPortFilter`; from a phone on the **guest** SSID the URL must **fail**; from a phone/tablet on the staff SSID it must work.

## 5. Network topology and Wi-Fi (staff-only)

```
        [ISP modem]  (optional; never required)
              │
      ┌───────┴────────┐
      │ Router/firewall│  DHCP pool .100–.200 · reservation Master = 192.168.10.10 (Option A)
      └───────┬────────┘
              │ Ethernet
      ┌───────┴──────────────────────────┐
      │ Managed/PoE switch               │
      ├───────────┬──────────┬───────────┤
   Ethernet      PoE        PoE   …     PoE
  ┌──────────┐ ┌──────┐  ┌──────┐     ┌──────┐
  │Master PC │ │ AP 1 │  │ AP 2 │ …   │ AP n │   SSID "Courts-Staff": WPA2/WPA3, hidden or unadvertised optional,
  │Win 11 UPS│ └──┬───┘  └──┬───┘     └──┬───┘   client isolation OFF, 5 GHz preferred
  │.10 :8080 │ phones/tablets C1–C6  C7–C12   … C24       "Guest" SSID: separate VLAN/isolated, cannot reach .10
  └──────────┘  (Front-desk PC on the same LAN: the same app, signed in as Staff or Admin)
```

- **Staff-only SSID** (owner-confirmed): WPA2/WPA3 with a strong passphrase known only to staff; *client isolation off* on this SSID only, so phones/tablets can reach the Master; because passwords are typed on those devices over plain HTTP (NFR-SEC-17), use a strong passphrase, rotate it when staff leave, and consider the optional HTTPS mode (SYSTEM_ARCHITECTURE §9); guests on a separate SSID/VLAN that cannot route to the Master.
- **Coverage over bandwidth:** each phone/tablet needs < 1 kbit/s. Plan roughly one enterprise-grade AP per 4–6 courts and verify with a **site survey**: RSSI ≥ −67 dBm at every court's device position, latency to Master < 20 ms (the Court page `?debug=1` overlay shows it). Fixed device positions on stands avoid roaming surprises; give APs fixed channels where possible.
- **24 courts:** ≈ 24 court devices + ≈ 10 other signed-in browsers ≈ 35 sockets (design 100); trivial for the router/AP controller (NFR-CAP).
- **Internet loss never affects the LAN:** the modem/ISP link is not in the data path; the router keeps switching and serving DHCP.

## 6. Installation (Master PC)

1. Complete §2–§3 (a checklist script automates §2 and §4; §3 Option B is manual because it needs the real subnet).
2. Run `PickleScoringSetup-<version>.exe` (Inno Setup; unsigned builds show a SmartScreen "unrecognized app → More info → Run anyway" prompt unless code-signed — Q31). It:
   - installs to `C:\Program Files\PickleScoring\` (bundled Node 24 `runtime\node.exe`, app `dist\`, `node_modules\` with the prebuilt `better-sqlite3` win32-x64 binary, `winsw.exe` + `PickleScoring.xml`);
   - creates the data directory `C:\ProgramData\PickleScoring\` (`pickle.db`, `backups\`, `logs\`, `config.json`, `shutdown.secret`) and grants the service account modify rights;
   - registers the Windows service **"Pickle Scoring Service"** (table below);
   - creates the firewall rule from §4;
   - creates Start-menu/desktop shortcuts "Pickle Scoring" (`http://localhost:8080`) and "Pickle Scoring Tools" (CLI prompt);
   - starts the service and opens the app.
3. In the browser, complete first-run setup on the Master PC itself: **Admin** account → facility name and operating hours → number of courts (0–24). Then add Staff accounts under Administration → Users (**as many as needed — there is no limit**).
4. Note the app URL shown at the end (also under Administration → Settings → Connect a device).

| Service setting (WinSW) | Value |
|-------------------------|-------|
| Name / ID | "Pickle Scoring Service" / `PickleScoring` |
| Start type | Automatic (Delayed) — starts at boot with no user logged in |
| Account | `NT AUTHORITY\LocalService` (no network credentials). If backups go to a **network share**, use a dedicated local account that has rights to the share (USB drives work with the default account) |
| Recovery | Restart after 5 s on the first 3 failures, then every 60 s; reset failure count after 1 day |
| Stop | `<stopexecutable>` = `runtime\node.exe dist\cli.js stop` → loopback `POST /internal/shutdown` (secret from `shutdown.secret`); `<stoptimeout>` 15 s, then forced kill (data-safe, NFR-REL-01) |
| Logs | Service wrapper log to `logs\` (roll by size); application logs in `logs\` (pino-roll, 14 days) |

**CLI** (`pickle-scoring <command>`): `print-urls` · `reset-admin-password` (interactive; requires local access) · `backup` · `restore <file>` (service stopped) · `rebuild-match <id>` · `check-db` · `stop`.

**Upgrades:** run the newer installer → stops the service, replaces program files (never the data directory), starts the service → `pre_migration` backup, then migrations. Open browsers reload on the version change (`server:hello.version`). Rollback: reinstall the previous version and restore the `pre_migration` backup. **Uninstall** leaves `C:\ProgramData\PickleScoring` untouched.

## 7. Court phone/tablet setup (staff-only Wi-Fi)

Goal: each court's phone or tablet opens `http://192.168.10.10:8080` full-screen, never sleeps, cannot wander off to other apps, and is **assigned to its court** so that it is called "Court 1", "Court 2", …

| Platform | Steps |
|----------|-------|
| **iPhone / iPad** | Join *Courts-Staff* → Safari → app URL → Share → *Add to Home Screen* → open from the Home Screen icon → sign in → **Use this device for Court N**. Settings → Display & Brightness → Auto-Lock **Never**; enable **Guided Access** (Accessibility), start it on the app and disable touch on status areas; keep on charger. |
| **Android phone / tablet** | Join *Courts-Staff* → Chrome → app URL → ⋮ → *Add to Home screen* → open → sign in → **Use this device for Court N**. Developer options → **Stay awake while charging**; set display timeout to max; **Screen pinning** (Settings → Security) or a kiosk browser (e.g. Fully Kiosk Browser) for a locked-down device. |
| **Windows tablet / laptop** | Edge or Chrome → app URL → sign in → assign the court. Kiosk: `msedge --kiosk http://192.168.10.10:8080 --edge-kiosk-type=fullscreen` (or Windows *Assigned Access* for a dedicated account). Power plan: never sleep when plugged in. |
| **All** | Disable browser translation prompts and any "HTTPS-only / HTTPS-first" mode for this site (the LAN site is plain HTTP; browsers normally exempt private IPs, but strict modes may block it); set brightness high (outdoor courts); mount securely so only the referee handles it; give each device a DHCP reservation if the router supports it (easier support, not required). **Label each device physically** ("Court 3") so the name on the screen and the sticker agree. |

**Assignment is stored on the server-side session**, so it survives refreshes, browser restarts and reboots as long as the session is valid (court devices keep a session for `terminalSessionDays`, default 30, with no idle timeout). If the cookie is cleared or the session expires, the device shows the sign-in screen and, after sign-in, a one-tap **"Continue as Court 3"** (the court id is remembered in the browser only as a hint). A different referee can use *Switch user* without losing the court. Because every action is recorded under the signed-in person, shared logins are discouraged; create one Staff account per person (unlimited).

**Replacing a device:** sign in on the new phone, choose *Use this device for Court 3*, confirm *Replace the current Court 3 device?* — the in-progress match appears exactly where it was. The Admin can also *Sign device out* from the Court page.

## 8. Offline-first behaviour

### 8.1 Three different kinds of "offline"

| Condition | What is affected | What the system does |
|-----------|-----------------|---------------------|
| **No internet** (WAN down, LAN fine) | Nothing | The system never uses the internet; everything works normally. Windows may show "No internet" on the Master PC; ignore it. |
| **Local network down/degraded** (Wi-Fi outage, AP failure, switch failure) | Court devices (and LAN front-desk PCs) cannot reach the Master | Affected devices show "Reconnecting to the Master…", lock scoring, keep the last known score visible (dimmed, with last-sync time). The Master keeps running; Staff/Admin on the Master PC (localhost) still work, see those devices offline, can score those courts from the Court page and still see the Booking Schedule. |
| **Master service unreachable** (restarting, crashed, PC off) | All devices (including bookings and sign-in, which live on the Master) | Same as above for every court. The service auto-restarts; devices reconnect automatically. |

A phone/tablet cannot distinguish "LAN down" from "Master down" — both mean "Master unreachable", and the UI says exactly that, with a hint: *"If this lasts more than a minute, tell the front desk."*

### 8.2 Scenario playbook (required behaviour)

| # | Scenario | Court device | Master | Data | Timer |
|---|----------|-------------|--------|------|-------|
| 1 | Internet unavailable | Normal | Normal | Normal | Normal |
| 2 | Internet down, local Wi-Fi up | Normal | Normal | Normal | Normal |
| 3 | One court device temporarily disconnects | After ≤ 15 s: reconnect banner, scoring locked; last score dimmed. A tap in flight is kept and retried with the same `commandId` after reconnect (applied at most once; `END_MATCH` is never auto-retried). On reconnect: the session cookie re-authenticates it, the server re-joins its assigned court, it receives the fresh snapshot and the UI unlocks. The referee uses **Adjust score** for rallies played meanwhile. | Marks the court's device offline (dashboard alert if a match is active); match unaffected; Staff/Admin may score on the referee's behalf from the Court page. | No loss; nothing written while disconnected. | Keeps running (server timestamps). |
| 4 | Master application restarts (update, crash + auto-restart) | Receives `server:shutdown` (graceful) or detects the disconnect; shows "Master restarting…"; reconnects automatically (1–5 s backoff); detects the new `instanceId`; refetches state. | Startup sequence (SYSTEM_ARCHITECTURE §12); all active matches resumed from the DB; sessions persist (everyone, including court devices, stays signed in and returns to the same court). | Every acknowledged command was committed before acknowledgement → nothing lost. Unacknowledged in-flight commands are retried idempotently. | Continues counting. |
| 5 | Court device refreshes its browser | Loads app → session cookie → `GET /auth/me` returns the assigned court → renders the exact current state (match, phase, pause, interstitial). A half-filled new-match wizard is restored from `sessionStorage`. | Socket reconnect only. | Unaffected. | Correct immediately. |
| 6 | Master PC shuts down unexpectedly (power loss beyond the UPS, crash) | As scenario 4 but longer; devices retry indefinitely. | On boot (BIOS "power on after AC loss") the service auto-starts → `quick_check` → (if corrupt → Recovery mode) → matches resumed; matches idle longer than `staleMatchMinutes` flagged `needs_review`. | SQLite WAL + `synchronous=FULL`: all committed transactions survive power loss. At most the in-flight request is lost — and the client retries it. | Continues counting through downtime. Staff/Admin review flagged matches. |
| 7 | Local network unavailable entirely | All courts: reconnect banner, scoring locked; referees keep score on paper. | Runs normally; Staff/Admin on the Master PC see all devices offline. | No writes from courts → no conflicts. | Continue counting. After recovery, referees reconcile with **Adjust score**; Admin can correct durations if a match ended during the outage. |
| 8 | UPS on battery, outage continues | No change until shutdown | Windows performs a controlled shutdown at the critical battery action (§2.1) → service stop path (graceful) | Clean WAL checkpoint | Continues in real life; timers resume from timestamps on next boot |
| 9 | Windows Update forces a restart | As scenario 4 | Active Hours prevent it during opening hours; if it happens, scenario 4 | None | Continues |

### 8.3 Why scoring is locked when disconnected (1.0 decision)
The Master is the authoritative source of truth. Allowing a disconnected device to keep scoring creates two divergent versions of the match (e.g. staff may have paused/ended it from another device, or the court's phone may have been replaced). Safe offline scoring requires an outbox, replay, conflict detection and a resolution UI. For 1.0 the reliable behaviour is: **lock, tell the user, reconcile with Adjust score**. Outages are expected to be rare and short on a surveyed LAN with a UPS.

### 8.4 Deferred design: offline scoring queue (post-1.0, only if outages prove common)
1. While disconnected, the court applies commands locally with the shared engine against its last snapshot, stores them in an IndexedDB outbox `{commandId, baseVersion, type, payload, localAt}`, and shows an "Unsynced (n)" badge (score clearly provisional).
2. On reconnect, the outbox is sent as one batch `POST /matches/:id/commands/batch { baseVersion, commands[] }`.
3. Server: if `match.version == baseVersion` and the match is still active → apply all in order (idempotent per `commandId`) with timestamps clamped to `[lastEventAt, now]`.
4. Otherwise reject the batch with the server snapshot; the device shows a resolution screen: "Staff changed this match while you were offline: keep server score / apply my score as an adjustment".
5. Requires a per-device monotonic local sequence and outbox persistence across refresh. Estimated effort 1–2 weeks incl. tests.

### 8.5 Duplicate submissions, reconnection and sync — rules recap
- **Idempotency**: `(match_id, command_id)` unique; duplicates return the current snapshot with `duplicate: true`.
- **Ordering**: one in-flight command per client; the server serializes all commands; `expectedVersion` rejects stale intent.
- **State sync**: full snapshot pushed on connect and after every change; clients ignore older versions; no client-side merging.
- **Timer sync**: server timestamps + measured offset; never a client-side stopwatch.
- **Restart detection**: `server:hello.instanceId` (new each process start) and `dbGeneration` (new after restore) trigger a full refetch; a `version` change triggers a reload.
- **Correct court after reconnect**: the court is the server-side assignment on the user's session (`user_sessions.terminal_court_id`), derived on the server from the session cookie; if the session expired, sign-in plus "Continue as Court N" restores it.

## 9. Backup and restore (Admin only)

### 9.1 What is backed up
The SQLite database (all data). `config.json` is copied alongside each backup as `pickle-<ts>-<type>.config.json`.

### 9.2 How
- better-sqlite3 `db.backup(dest)` — online, consistent, does not block scoring meaningfully.
- After writing: open the copy read-only and run `PRAGMA integrity_check`; on failure delete it and raise an alert.
- Retention: newest `backupRetention` (default 30) of type scheduled/manual; newest 5 each of `pre_migration` and `pre_restore`.
- Optional `backupExtraPath`: a **USB drive** (use a stable path; Windows may change the drive letter when the stick is re-inserted — label the drive and re-test the path in Settings → Backups → "Test") or a **network share** (UNC path, requires the service account note in §6). Failure → alert, not fatal.
- Recommended: rotate a second USB stick off-site weekly.

### 9.3 Restore procedure (Admin)
1. Select a backup (or upload a file).
2. Server validates the candidate: opens read-only, `integrity_check`, checks `user_version` ≤ app schema version (newer → refuse).
3. Active matches and no `force` → `409 ACTIVE_MATCHES_EXIST`.
4. Maintenance gate on (commands → 503), `server:shutdown {reason:"restore"}`.
5. `pre_restore` backup of the current DB.
6. Close DB; replace `pickle.db` (remove `-wal`/`-shm`); reopen; migrate if older; new `dbGeneration`.
7. Stale active matches from the backup flagged `needs_review`.
8. Gate off; `system:restored`; clients reload. Audit entry `backup.restore` written to the restored DB.

### 9.4 Offline restore (service won't start)
Stop the service (`Stop-Service PickleScoring`) → `pickle-scoring restore <file>` → `Start-Service PickleScoring`. Documented on the printed admin quick-reference card.

## 10. Recovery scenarios

| Problem | Symptom | Recovery |
|---------|---------|----------|
| Database corruption | Service starts in Recovery mode; the app shows the recovery page to the Admin | Restore the newest valid backup. Data since that backup is lost — hence daily backups, the extra path and the UPS. |
| Disk full | Writes fail; alert; health shows error | Free space; logs auto-rotate; old backups pruned |
| Master PC dead | Nothing reachable | Install on a replacement Windows 11 PC → restore the latest backup → give it the **same IP** (§3) → phones/tablets reconnect and stay signed in (sessions and court assignments are in the DB) |
| Master IP/port changed | Phones/tablets can't connect | Restore the old IP (preferred). A new IP is a new browser origin, so each device must open the new URL, sign in and choose its court again (≈ 30 s each). **Hence the fixed-IP requirement.** |
| Windows network profile flipped to Public | Phones/tablets suddenly can't connect | The §4 rule is subnet-scoped and profile-independent; re-set the profile to Private anyway |
| Service not running | Devices show "Reconnecting"; Master URL fails | `Get-Service PickleScoring` → `Start-Service`; check `logs\`; recovery settings should already have restarted it |
| Lost all Admin passwords | Cannot log in | `pickle-scoring reset-admin-password` on the Master PC |
| Staff forgot password | Cannot log in | Admin resets it in Settings → Users |
| Court device lost/broken | Court shows device offline | Admin: *Sign device out* on the Court page (optional); sign in on a replacement and choose *Use this device for Court N* (the match continues where it was); Staff can score from the Court page on any device meanwhile |
| Accidental early end | Match shows "Ended early" | Admin result correction (MATCH_SCORING_LOGIC §5.12) |
| Wrong data entered for a whole match | — | Admin correction + edit names; audit-logged |

## 11. Operations checklist

**Daily (automatic):** backup at 23:30, cleanup job, weekly restore-verify.
**Daily (staff, 1 min):** dashboard shows all court devices online; no `needs_review` alerts.
**Monthly (Admin):** confirm the last backup reached the extra path; swap the off-site USB; check disk space (System info); test signing in and assigning a spare phone/tablet to a court; review the Users list and deactivate leavers.
**After any power event:** confirm the app loads (service running), resolve `needs_review` matches.
**Go-live acceptance on site (Phase 14):** every court device signs in, is assigned to its court, scores a full match, survives airplane-mode toggling and a Master service restart; guest SSID cannot reach the Master; pull the Master's Ethernet cable and confirm the §8.2 row 7 behaviour; run a UPS pull-the-plug test.
