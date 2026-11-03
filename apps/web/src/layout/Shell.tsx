import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CalendarDays, Shuffle, ChevronDown, History, Gauge, LayoutGrid, LogOut, Maximize2, ScrollText, Settings, ShieldCheck, UserCog, Users, DatabaseBackup, SlidersHorizontal, Smartphone } from 'lucide-react';
import type { MeDto } from '@pickle/shared';
import { ConnectionBadge, RoleBadge, ToastHost, cx } from '../ui';
import { useLogout } from '../lib/auth';
import { useAssignCourt } from '../pages/AssignCourt';

/** Sidebar groups (real routes only). Reports live in the Dashboard's Analytics tab. */
export const NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  { label: 'Overview', items: [{ to: '/dashboard', label: 'Dashboard' }] },
  { label: 'Operations', items: [{ to: '/courts', label: 'Court Management' }, { to: '/bookings', label: 'Booking Schedule' }, { to: '/open-play', label: 'Open Play' }, { to: '/history', label: 'Game Histories' }, { to: '/players', label: 'Players' }] },
];
export const NAV = [
  { to: '/dashboard', label: 'Dashboard', short: 'Home', icon: Gauge },
  { to: '/bookings', label: 'Booking Schedule', short: 'Bookings', icon: CalendarDays },
  { to: '/courts', label: 'Court Management', short: 'Courts', icon: LayoutGrid },
  { to: '/open-play', label: 'Open Play', short: 'Open Play', icon: Shuffle },
  { to: '/history', label: 'Game Histories', short: 'History', icon: History },
  { to: '/players', label: 'Players', short: 'Players', icon: Users },
];
export const ADMIN_NAV = [
  { to: '/admin/users', label: 'Users', icon: UserCog },
  { to: '/admin/presets', label: 'Rule presets', icon: SlidersHorizontal },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/admin/backups', label: 'Backups', icon: DatabaseBackup },
];

/** True when the current page should be the bare full-screen scoring console (assigned device or ?fs=1). */
export function useConsoleMode(me: MeDto): boolean {
  const { pathname, search } = useLocation();
  const m = /^\/courts\/(\d+)\/?$/.exec(pathname);
  if (!m) return false;
  return me.terminal?.courtId === Number(m[1]) || new URLSearchParams(search).get('fs') === '1';
}

export default function Shell({ me }: { me: MeDto }) {
  const consoleMode = useConsoleMode(me);
  const { pathname: path } = useLocation();
  const board = /^\/open-play\/\d+\/board\/?$/.test(path);
  if (consoleMode || board) return <><Outlet /><ToastHost large /></>;
  const admin = me.user.role === 'admin';
  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <Link to="/" className="flex items-center gap-3 border-b border-line px-4 py-4"><img src="/brand/app-icon.svg" alt="" className="size-9" /><span className="font-display truncate text-lg leading-tight">{me.publicSettings.facilityName}</span></Link>
        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}><p className="px-3 pb-1 pt-5 text-xs font-bold uppercase tracking-[.08em] text-muted">{g.label}</p>
              <div className="space-y-0.5">{g.items.map((i) => <SideLink key={i.to} {...NAV.find((n) => n.to === i.to)!} />)}</div></div>
          ))}
          {admin && <><p className="px-3 pb-1 pt-5 text-xs font-bold uppercase tracking-[.08em] text-muted">System</p><div className="space-y-0.5">{ADMIN_NAV.map((n) => <SideLink key={n.to} {...n} />)}</div></>}
        </nav>
        <div className="space-y-2 border-t border-line p-4"><ConnectionBadge /><div className="flex items-center gap-2 text-xs text-muted"><span>Powered by</span><img src="/brand/logo-primary.svg" alt="Peecool" className="h-4 w-auto" /></div><p className="text-[11px] text-muted">by Elpisoft</p></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} />
        <main className="flex-1 overflow-y-auto pb-20 md:pb-6"><div key={path} className="page-in mx-auto max-w-[1500px] p-4 md:p-6"><Outlet /></div></main>
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')}>
              <n.icon className="size-5" />{n.short}
            </NavLink>
          ))}
        </nav>
      </div>
      <ToastHost />
    </div>
  );
}

function SideLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Users }) {
  return (
    <NavLink to={to} className={({ isActive }) => cx('flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors', isActive ? 'bg-primary text-primary-ink shadow-card' : 'text-ink/80 hover:bg-surface2')}>
      <Icon className="size-4.5" />{label}
    </NavLink>
  );
}

function TopBar({ me }: { me: MeDto }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const { unassign } = useAssignCourt();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const onCourt = /^\/courts\/(\d+)/.exec(pathname);
  return (
    <header className="no-print flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center gap-3">
        <img src="/brand/app-icon.svg" alt="Peecool" className="size-8 md:hidden" />
        {me.terminal && <Link to={`/courts/${me.terminal.courtId}`} className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-sm font-semibold text-primary"><Smartphone className="size-4" />{me.terminal.courtName} device</Link>}
        <span className="md:hidden"><ConnectionBadge /></span>
      </div>
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface2">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">{me.user.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="hidden text-left sm:block"><span className="block text-sm font-medium leading-tight">{me.user.displayName}</span></span>
          <RoleBadge role={me.user.role} /><ChevronDown className="size-4 text-muted" />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 page-in z-40 mt-1 w-64 overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-pop">
            <MenuLink to="/account" icon={ShieldCheck}>My account</MenuLink>
            {onCourt && !me.terminal && <MenuLink to={`/courts/${onCourt[1]}?fs=1`} icon={Maximize2}>Full-screen scoring</MenuLink>}
            {onCourt && me.terminal?.courtId === Number(onCourt[1]) && null}
            {me.terminal
              ? <button role="menuitem" className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface2" onClick={() => void unassign()}><Smartphone className="size-4" />Stop using this device for {me.terminal.courtName}</button>
              : <MenuLink to="/?assign=1" icon={Smartphone}>Use this device for Court…</MenuLink>}
            {me.user.role === 'admin' && <div className="border-t border-line py-1 md:hidden">{ADMIN_NAV.map((n) => <MenuLink key={n.to} to={n.to} icon={n.icon}>{n.label}</MenuLink>)}</div>}
            <button role="menuitem" className="flex w-full items-center gap-3 border-t border-line px-4 py-2 text-left text-sm hover:bg-surface2" onClick={() => void logout()}><LogOut className="size-4" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
function MenuLink({ to, icon: Icon, children }: { to: string; icon: typeof Users; children: React.ReactNode }) {
  return <Link role="menuitem" to={to} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface2"><Icon className="size-4" />{children}</Link>;
}
