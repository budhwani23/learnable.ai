import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/lib/admin";
import { ErrorNote, Pager, RoleBadge, fmtDate, useAdminData, useDebounced } from "./common";

const PAGE_SIZE = 50;

/**
 * Admin waitlist tab: searchable, paginated list of pending users with per-row and bulk approve/reject.
 * @param onChanged Called after a successful approve/reject so the parent can refresh counts.
 */
export default function WaitlistTab({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const query = useDebounced(q);
  const { data, error, loading, reload } = useAdminData(
    () => adminApi.waitlist({ q: query, page, page_size: PAGE_SIZE }), [query, page]);
  const users = data?.users ?? [];
  const allPicked = users.length > 0 && users.every(u => picked.has(u.id));
  // Only ever act on users that are visible right now.
  const visiblePicked = users.filter(u => picked.has(u.id)).map(u => u.id);

  /** Add or remove a user id from the bulk selection. */
  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Bulk approve or reject the given users via the admin API, toast the result, clear the selection and reload. */
  const act = async (ids: number[], action: "approve" | "reject") => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await adminApi.bulkWaitlist(ids, action);
      toast.success(`${action === "approve" ? "Approved" : "Rejected"} ${r.updated} user${r.updated === 1 ? "" : "s"}`
        + (r.skipped ? ` (${r.skipped} no longer waiting)` : ""));
      setPicked(new Set());
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input className="sm:max-w-xs" placeholder="Search waitlist" value={q}
               onChange={(e) => { setQ(e.target.value); setPage(1); setPicked(new Set()); }} />
        <div className="flex gap-2">
          <Button disabled={busy || visiblePicked.length === 0} className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => act(visiblePicked, "approve")} data-testid="bulk-approve">
            Approve selected ({visiblePicked.length})
          </Button>
          <Button variant="outline" disabled={busy || visiblePicked.length === 0} onClick={() => act(visiblePicked, "reject")}>
            Reject selected
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allPicked} aria-label="Select all"
                          onCheckedChange={(c) => setPicked(c ? new Set(users.map(u => u.id)) : new Set())} />
              </TableHead>
              <TableHead>User</TableHead>
              <TableHead>Signed up as</TableHead>
              <TableHead>Waiting since</TableHead>
              <TableHead className="text-right">Decide</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} data-testid={`waitlist-row-${u.username}`}>
                <TableCell>
                  <Checkbox checked={picked.has(u.id)} onCheckedChange={() => toggle(u.id)} aria-label={`Select ${u.username}`} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{u.username}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell><RoleBadge role={u.role} /></TableCell>
                <TableCell>{fmtDate(u.date_joined, true)}</TableCell>
                <TableCell className="text-right space-x-2 whitespace-nowrap">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy}
                          onClick={() => act([u.id], "approve")} data-testid={`approve-${u.username}`}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act([u.id], "reject")}>Reject</Button>
                </TableCell>
              </TableRow>
            ))}
            {data && users.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nobody is waiting. 🎉</TableCell></TableRow>
            )}
            {loading && !data && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => { setPage(p); setPicked(new Set()); }} />}
    </div>
  );
}
