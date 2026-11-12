import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Share2, Smartphone, Wifi } from 'lucide-react';
import { Button, Card, CardHeader, ErrorBox, Notice, PageHeader, Spinner, useNow } from '../ui';
import { fmtTime } from '../lib/time';
import { get } from '../lib/api';
import { toast } from '../lib/toast';

interface SeenDevice { ip: string; kind: string; lastSeenAt: number; requests: number; you: boolean }
interface ConnectInfo { facilityName: string; lanUrls: string[]; primaryUrl: string; port: number; viaDevServer: boolean; qrSvg: string; devices: SeenDevice[] }

/** The address and QR code a phone or tablet needs. Shown to Admin and Staff on /connect, and to the Admin in Settings. */
export function ConnectCard() {
  const q = useQuery({ queryKey: ['connect'], queryFn: () => get<ConnectInfo>('system/connect'), refetchInterval: 4_000 }); // live: a phone shows up in the list below within seconds
  const now = useNow(5_000);
  const [copied, setCopied] = useState(false);
  if (q.isLoading) return <Card><Spinner /></Card>;
  if (q.error || !q.data) return <Card><ErrorBox error={q.error} retry={() => q.refetch()} /></Card>;
  const d = q.data;
  const others = d.lanUrls.filter((u) => u !== d.primaryUrl);
  const noNetwork = d.lanUrls.length === 0;
  const copy = async () => {
    try { await navigator.clipboard.writeText(d.primaryUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); toast('Address copied', 'success'); }
    catch { toast('Could not copy: select the address and copy it by hand', 'error'); }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Card data-testid="connect-card">
      <CardHeader title="Connect a phone or tablet" sub="Scan the QR code, or type the address, on any device that is on the staff Wi-Fi." />
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_15rem]">
        <div className="space-y-5">
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3"><span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">1</span>
              <span><b>Join the staff Wi-Fi.</b> The phone or tablet must be on the same Wi-Fi as this computer, not on mobile data or a guest network.</span></li>
            <li className="flex gap-3"><span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">2</span>
              <span className="min-w-0 flex-1"><b>Scan the QR code</b> with the camera, or type this address into the browser:
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={d.primaryUrl} data-testid="connect-url" className="num break-all text-2xl font-bold text-primary underline-offset-4 hover:underline">{d.primaryUrl}</a>
                  <Button size="sm" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
                  {canShare && <Button size="sm" icon={<Share2 className="size-4" />} onClick={() => void navigator.share({ title: d.facilityName, url: d.primaryUrl }).catch(() => undefined)}>Share</Button>}
                </span></span></li>
            <li className="flex gap-3"><span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">3</span>
              <span><b>Sign in</b>, then choose <i>“Use this device for Court N”</i> so the device opens straight to that court every time.</span></li>
          </ol>
          <div className="rounded-xl border border-line p-4 text-sm" data-testid="seen-devices" aria-live="polite">
            <p className="font-bold">Is the phone getting through?</p>
            {d.devices.length === 0
              ? <p className="mt-1 text-muted">Nothing has reached this computer yet. Open the address on the phone now; it should appear here within a few seconds. <b className="text-ink">If it never appears, the network or the phone is blocking it</b>: see the checklist below.</p>
              : <ul className="mt-2 divide-y divide-line">{d.devices.map((x) => (
                  <li key={x.ip} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"><Smartphone className="size-4 text-success" aria-hidden /><span className="font-semibold">{x.kind}</span><span className="num tnum text-muted">{x.ip}</span>{x.you && <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-bold text-primary">this device</span>}<span className="ml-auto text-muted">{now - x.lastSeenAt < 15_000 ? 'just now' : `last seen ${fmtTime(x.lastSeenAt)}`}</span></li>))}</ul>}
          </div>
          {noNetwork && <Notice tone="warn"><Wifi className="mr-1 inline size-4" aria-hidden />This computer has no network address right now. Connect it to the Wi-Fi or LAN cable, then reload this page.</Notice>}
          {d.viaDevServer && <Notice tone="info">This app was opened through the development server (port {d.port}), so phones must use port {d.port} too. The address above already does.</Notice>}
          {others.length > 0 && (
            <p className="text-sm text-muted">This computer has other addresses. If the first one does not work, try: {others.map((u, i) => <span key={u}>{i > 0 && ', '}<span className="num font-semibold text-ink">{u}</span></span>)}</p>
          )}
          <details className="rounded-xl border border-line bg-surface2/50 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">The page will not open on the phone?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Check the phone is on the <b className="text-ink">same Wi-Fi</b> as this computer (turn off mobile data to be sure).</li>
              <li>Type <b className="text-ink">http://</b> (not https). This system works on the local network without a certificate.</li>
              <li><b className="text-ink">iPhone with Chrome:</b> Settings → Chrome → turn on <i>Local Network</i>. Safari does not need this.</li>
              <li>Some routers have <b className="text-ink">client isolation</b> (always on for guest Wi-Fi) that stops phones reaching this computer. Turn it off for the staff network.</li>
              <li><b className="text-ink">The phone never appears in the box above?</b> Its request is not reaching this computer. On the phone, try opening your router's own page (often <i>http://192.168.1.1</i>): if that loads but this does not, the Wi-Fi is stopping devices from talking to each other (see the next point).</li>
              <li>This computer's firewall must allow incoming connections for the app (the installer sets this up on Windows).</li>
              <li>If the address changed after a restart, reload this page for the new one. Ask for a fixed address for this computer in the router.</li>
            </ul>
          </details>
          <Notice tone="warn">Passwords are typed over the facility Wi-Fi without encryption. Keep the staff Wi-Fi private with a strong password and separate from guest Wi-Fi.</Notice>
        </div>
        <div className="mx-auto w-full max-w-60 space-y-2 text-center md:mx-0">
          <div className="rounded-2xl border border-line bg-white p-3 shadow-card [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label={`QR code for ${d.primaryUrl}`} data-testid="connect-qr" dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted"><Smartphone className="size-4" aria-hidden />Point the phone camera here</p>
        </div>
      </div>
    </Card>
  );
}

export default function Connect() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Connect a phone or tablet" sub="Use a phone or tablet as a court's scoring screen, or to check the schedule." />
      <ConnectCard />
    </div>
  );
}
