import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BrandLoader, ErrorBox, Card } from './ui';
import { useMe } from './lib/auth';
import { realtime } from './lib/realtime';
import { setUnauthenticatedHandler } from './lib/api';
import { setFacilityTimeZone } from './lib/time';
import { applyTheme } from './lib/theme';
import Login from './pages/Login';
import ForcedChangePassword from './pages/ChangePassword';
import { AssignGate, CourtPicker, ASSIGN_DONE_KEY } from './pages/AssignCourt';
import Shell from './layout/Shell';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Courts = lazy(() => import('./pages/Courts'));
const CourtPage = lazy(() => import('./pages/CourtPage'));
const OpenPlay = lazy(() => import('./pages/OpenPlay'));
const OpenPlaySession = lazy(() => import('./pages/OpenPlaySession'));
const OpenPlayBoard = lazy(() => import('./pages/OpenPlayBoard'));
const History = lazy(() => import('./pages/History'));
const MatchDetail = lazy(() => import('./pages/MatchDetail'));
const Players = lazy(() => import('./pages/Players'));
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'));
const Account = lazy(() => import('./pages/Account'));
const Users = lazy(() => import('./pages/admin/Users'));
const Presets = lazy(() => import('./pages/admin/Presets'));
const SettingsPage = lazy(() => import('./pages/admin/Settings'));
const Audit = lazy(() => import('./pages/admin/Audit'));
const Backups = lazy(() => import('./pages/admin/Backups'));

export default function App() {
  const qc = useQueryClient();
  const me = useMe();
  useEffect(() => { applyTheme(); setUnauthenticatedHandler(() => { void qc.invalidateQueries({ queryKey: ['me'] }); }); }, [qc]);
  const user = me.data;
  useEffect(() => {
    if (user && !user.mustChangePassword) { setFacilityTimeZone(user.publicSettings.timeZone); realtime.start(qc); }
    else realtime.stop();
  }, [user?.user.id, user?.mustChangePassword, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (me.isLoading) return <BrandLoader />;
  if (me.error) return <div className="grid h-full place-items-center"><Card className="max-w-md"><ErrorBox error={me.error} retry={() => me.refetch()} /></Card></div>;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ForcedChangePassword />;
  return (
    <AssignGate me={user}>
      <Suspense fallback={<BrandLoader />}>
        <Routes>
          <Route element={<Shell me={user} />}>
            <Route index element={<Home me={user} />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="courts" element={<Courts />} />
            <Route path="courts/:id" element={<CourtPage />} />
            <Route path="open-play" element={<OpenPlay />} />
            <Route path="open-play/:id" element={<OpenPlaySession />} />
            <Route path="open-play/:id/board" element={<OpenPlayBoard />} />
            <Route path="history" element={<History />} />
            <Route path="history/:id" element={<MatchDetail />} />
            <Route path="players" element={<Players />} />
            <Route path="players/:key" element={<PlayerDetail />} />
            <Route path="account" element={<Account />} />
            {user.user.role === 'admin' && <>
              <Route path="admin/users" element={<Users />} /><Route path="admin/presets" element={<Presets />} />
              <Route path="admin/settings" element={<SettingsPage />} /><Route path="admin/audit" element={<Audit />} /><Route path="admin/backups" element={<Backups />} />
            </>}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AssignGate>
  );
}

/** "/" → the assigned court's console, otherwise the dashboard. `/?assign=1` re-opens the court picker. */
function Home({ me }: { me: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const [sp, setSp] = useSearchParams();
  if (sp.get('assign') === '1') return <CourtPicker onPicked={() => { try { sessionStorage.setItem(ASSIGN_DONE_KEY, '1'); } catch { /* */ } setSp({}); }} onSkip={() => setSp({})} />;
  return <Navigate to={me.terminal ? `/courts/${me.terminal.courtId}` : '/dashboard'} replace />;
}
