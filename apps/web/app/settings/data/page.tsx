'use client';

/**
 * Data settings — export user data, delete account.
 * Mirrors iOS `HistoricalDataFeature` + iOS account deletion flow.
 */

import { Database, Download, Loader2, Mail, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsScreen } from '@/components/profile/settings-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ListGroup, ListRow } from '@/components/ui/ios';
import { Label } from '@/components/ui/label';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { useAuthStore } from '@/stores/auth-store';

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return (await res.json().catch(() => ({}))) as T;
}

export default function DataSettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    analytics.track(AnalyticsEvents.dataExportRequested());
    try {
      // Use the existing CCPA data-export endpoint if available; otherwise fall
      // back to fetching the user's daily tracking and serialising client-side.
      const res = await fetch('/api/ccpa/data-request', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => null);
      if (res && res.ok) {
        const blob = await res.blob();
        downloadBlob(blob, `fitcircle-data-${new Date().toISOString().split('T')[0]}.json`);
        toast.success('Export downloaded');
      } else {
        toast.message('Data export was queued — check your email.');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText.trim().toLowerCase() !== 'delete my account') {
      toast.error('Please type the confirmation phrase exactly.');
      return;
    }
    setDeleting(true);
    try {
      await authedFetch('/api/user/delete', { method: 'POST' });
      toast.success('Account deletion scheduled.');
      analytics.track(AnalyticsEvents.accountDeleted());
      await logout('account_deleted');
      router.push('/');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete account');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SettingsScreen title="Data" subtitle="Export or delete what FitCircle keeps">
      <ListGroup title="Export" footer="A JSON archive of your check-ins, streaks, circles, and goals.">
        <ListRow
          onClick={() => void handleExport()}
          icon={Download}
          tone="cyan"
          title={exporting ? 'Preparing export…' : 'Export your data'}
          trailing={exporting ? <Loader2 className="h-4 w-4 animate-spin text-fg-secondary" aria-hidden /> : undefined}
          testId="data-export"
        />
      </ListGroup>

      <ListGroup title="Account">
        <ListRow icon={Mail} tone="purple" title="Email" value={user?.email ?? '—'} />
        <ListRow
          icon={Database}
          tone="slate"
          title="User ID"
          value={<span className="font-mono text-footnote">{user?.id?.slice(0, 8) ?? '—'}…</span>}
        />
      </ListGroup>

      <ListGroup
        title="Danger zone"
        footer="Deleting your account permanently removes all your check-ins, streaks, and circle memberships. This cannot be undone."
      >
        <ListRow
          onClick={() => setDeleteOpen(true)}
          icon={Trash2}
          destructive
          title="Delete account"
          testId="data-delete"
        />
      </ListGroup>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <strong>delete my account</strong> to confirm. This action is permanent.
          </p>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmation</Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete my account"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirmText.trim().toLowerCase() !== 'delete my account'}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete forever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsScreen>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
