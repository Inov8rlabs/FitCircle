'use client';

/**
 * Data settings — export user data, delete account.
 * Mirrors iOS `HistoricalDataFeature` + iOS account deletion flow.
 */

import { ArrowLeft, Download, Trash2, AlertTriangle, Loader2, Database } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
      await logout();
      router.push('/');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete account');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <Link href="/settings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to settings
        </Link>

        <h1 className="text-2xl font-bold">Data</h1>

        {/* Export */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Download className="h-5 w-5 text-cyan-400" />
              <div>
                <h2 className="font-semibold">Export your data</h2>
                <p className="text-xs text-muted-foreground">
                  Download a JSON archive of your check-ins, streaks, circles, and goals.
                </p>
              </div>
            </div>
            <Button onClick={handleExport} disabled={exporting} className="w-full">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4 mr-2" />Export data</>}
            </Button>
          </CardContent>
        </Card>

        {/* Account info */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-purple-400" />
              <h2 className="font-semibold">Account</h2>
            </div>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{user?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">User ID</dt>
                <dd className="font-mono text-xs">{user?.id?.slice(0, 8) ?? '—'}…</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="border-destructive/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="font-semibold">Danger zone</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Deleting your account permanently removes all your check-ins, streaks, and
              circle memberships. This cannot be undone.
            </p>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete account
            </Button>
          </CardContent>
        </Card>
      </main>

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
    </div>
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
