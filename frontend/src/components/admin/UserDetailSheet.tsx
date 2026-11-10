import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { adminApi, type AdminRole } from "@/lib/admin";
import { RESOURCE_TYPES, type AccountStatus, type ResourceType } from "@/lib/types";
import { ACTION_LABELS, ErrorNote, RoleBadge, StatusBadge, fmtDate, useAdminData } from "./common";

type Confirm = { title: string; body: string; action: (reason: string) => Promise<unknown>; destructive?: boolean; withReason?: boolean };

export default function UserDetailSheet({ userId, onClose, onChanged }: {
  userId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user: me } = useAuth();
  const { data: u, error, loading, reload } = useAdminData(
    () => (userId ? adminApi.user(userId) : Promise.resolve(null)), [userId]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState("");
  const [creditType, setCreditType] = useState<ResourceType | "all">("all");
  const [amount, setAmount] = useState("3");

  const isSelf = !!u && u.id === me?.id;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: AccountStatus, label: string, destructive = false) => {
    if (!u) return;
    if (status === "approved" || status === "pending") {
      return run(() => adminApi.setStatus(u.id, status), `${u.username}: ${label}`);
    }
    setReason("");
    setConfirm({
      title: `${label} ${u.username}?`,
      body: status === "banned"
        ? "They will be signed out of every API call and can't sign in again until unbanned."
        : "They won't be able to use the app. They'll see this decision when they sign in.",
      destructive, withReason: true,
      action: (why) => adminApi.setStatus(u.id, status, why),
    });
  };

  const credits = (action: "grant" | "set" | "reset") => {
    if (!u) return;
    const n = Number(amount);
    if (action !== "reset" && (!Number.isInteger(n) || n < 0 || (action === "grant" && n === 0))) {
      toast.error("Enter a whole number of credits.");
      return;
    }
    const what = creditType === "all" ? "every resource" : RESOURCE_TYPES.find(r => r.id === creditType)?.label;
    const msg = action === "grant" ? `Added ${n} ${what} credit(s)` : action === "set" ? `${what}: ${n} credits left` : `Reset ${what} credits`;
    run(() => adminApi.changeCredits(u.id, action, creditType, action === "reset" ? 0 : n), msg);
  };

  return (
    <Sheet open={userId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="user-detail">
        <SheetHeader>
          <SheetTitle>{u?.username ?? "User"}</SheetTitle>
          <SheetDescription>{u?.email || (u ? "No email on file" : "")}</SheetDescription>
        </SheetHeader>
        <ErrorNote error={error} />
        {loading && !u && <div className="space-y-3 mt-4"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>}
        {u && (
          <div className="mt-4 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge role={u.role} />
              <StatusBadge user={u} />
              {u.is_superuser && <span className="text-xs text-muted-foreground">superuser</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Joined</dt><dd>{fmtDate(u.date_joined, true)}</dd>
              <dt className="text-muted-foreground">Last active</dt><dd>{fmtDate(u.last_login, true)}</dd>
              <dt className="text-muted-foreground">Status changed</dt><dd>{fmtDate(u.status_changed_at, true)}</dd>
              {u.status_reason && (<><dt className="text-muted-foreground">Reason</dt><dd>{u.status_reason}</dd></>)}
            </dl>

            {isSelf ? (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                This is your account. Another administrator has to change your status, role or access.
              </p>
            ) : (
              <section className="space-y-3">
                <h4 className="text-sm font-semibold">Access</h4>
                <div className="flex flex-wrap gap-2">
                  {u.status !== "approved" && u.role !== "admin" && (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy}
                            onClick={() => setStatus("approved", "approved")} data-testid="approve-user">
                      {u.status === "banned" ? "Unban" : "Approve"}
                    </Button>
                  )}
                  {u.status === "pending" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("rejected", "Reject")}>Reject</Button>
                  )}
                  {u.status === "approved" && u.role !== "admin" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("pending", "moved to waitlist")}>
                      Move to waitlist
                    </Button>
                  )}
                  {u.status !== "banned" && u.role !== "admin" && (
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => setStatus("banned", "Ban", true)}>Ban</Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => u.is_active
                            ? setConfirm({
                              title: `Deactivate ${u.username}?`,
                              body: "They lose access immediately (sign-in and every API call) until reactivated.",
                              destructive: true,
                              action: () => adminApi.setActive(u.id, false),
                            })
                            : run(() => adminApi.setActive(u.id, true), `${u.username} reactivated`)}>
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-12 text-sm">Role</Label>
                  <Select value={u.role} disabled={busy}
                          onValueChange={(r) => run(() => adminApi.setRole(u.id, r as AdminRole), `${u.username} is now ${r}`)}>
                    <SelectTrigger className="w-40" data-testid="role-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="teacher">Teacher</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">Only superusers can grant or remove admin.</span>
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Credits</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead className="text-right">Left</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">Refunded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RESOURCE_TYPES.map((r) => {
                    const c = u.credits[r.id];
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className={`text-right font-medium ${c.remaining === 0 ? "text-red-600" : ""}`}
                                   data-testid={`detail-credits-${r.id}`}>{c.remaining}</TableCell>
                        <TableCell className="text-right">{c.used}</TableCell>
                        <TableCell className="text-right">{c.limit}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{u.usage[r.id]?.refunded ?? 0}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-xs">Resource</Label>
                  <Select value={creditType} onValueChange={(v) => setCreditType(v as ResourceType | "all")}>
                    <SelectTrigger className="w-40" data-testid="credit-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All resources</SelectItem>
                      {RESOURCE_TYPES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Credits</Label>
                  <Input type="number" min={0} max={1000} className="w-24" value={amount}
                         onChange={(e) => setAmount(e.target.value)} data-testid="credit-amount" />
                </div>
                <Button size="sm" disabled={busy} onClick={() => credits("grant")} data-testid="grant-credits">Add</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => credits("set")}>Set remaining</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => credits("reset")}>Reset usage</Button>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Recent generations</h4>
              {u.recent_generations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No generations yet.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {u.recent_generations.map((g) => (
                    <li key={g.id} className="flex justify-between px-3 py-1.5">
                      <span>{RESOURCE_TYPES.find(r => r.id === g.resource_type)?.label}{g.refunded && <span className="ml-2 text-xs text-muted-foreground">(failed, refunded)</span>}</span>
                      <span className="text-muted-foreground">{fmtDate(g.created_at, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Admin history</h4>
              {u.audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No admin changes.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {u.audit.map((a) => (
                    <li key={a.id} className="px-3 py-1.5">
                      <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>
                      <span className="text-muted-foreground"> by {a.actor} · {fmtDate(a.created_at, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
            </AlertDialogHeader>
            {confirm?.withReason && (
              <div className="space-y-1">
                <Label htmlFor="reason">Reason (shown to the user, optional)</Label>
                <Input id="reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={confirm?.destructive ? "bg-red-600 hover:bg-red-700" : ""}
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  if (c) run(() => c.action(reason.trim()), "Done");
                }}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
