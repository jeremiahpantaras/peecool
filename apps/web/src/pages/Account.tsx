import { Card, CardHeader, PageHeader, RoleBadge } from '../ui';
import { useMe } from '../lib/auth';
import { PasswordForm } from './ChangePassword';
import { useAssignCourt } from './AssignCourt';
import { Button } from '../ui';

export default function Account() {
  const me = useMe().data!;
  const { unassign } = useAssignCourt();
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="My account" />
      <Card><CardHeader title="Profile" />
        <dl className="grid grid-cols-[120px_1fr] gap-2 p-4 text-sm"><dt className="text-muted">Name</dt><dd className="font-medium">{me.user.displayName}</dd><dt className="text-muted">Username</dt><dd>{me.user.username}</dd><dt className="text-muted">Role</dt><dd><RoleBadge role={me.user.role} /></dd>
          <dt className="text-muted">This device</dt><dd>{me.terminal ? <span className="inline-flex flex-wrap items-center gap-3"><b>{me.terminal.courtName}</b><Button size="sm" onClick={() => void unassign()}>Stop using this device for {me.terminal.courtName}</Button></span> : 'Not assigned to a court'}</dd></dl></Card>
      <Card><CardHeader title="Change password" /><div className="p-4"><PasswordForm /></div></Card>
    </div>
  );
}
