import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/lib/admin";
import { RESOURCE_TYPES } from "@/lib/types";
import { ACTION_LABELS, ErrorNote, Pager, fmtDate, useAdminData, useDebounced } from "./common";

/** Admin usage tab: per-resource generations, refunds, users and out-of-credit counts, plus the heaviest users for the chosen period. */
export function UsageTab() {
  const [days, setDays] = useState("30");
  const { data, error } = useAdminData(() => adminApi.usage(Number(days)), [days]);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ErrorNote error={error} />
      {data && (
        <>
          <Card className="overflow-x-auto">
            <Table data-testid="usage-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead className="text-right">Generations</TableHead>
                  <TableHead className="text-right">Failed (refunded)</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Users out of credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RESOURCE_TYPES.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right font-medium">{data.by_type[r.id].charged}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{data.by_type[r.id].refunded}</TableCell>
                    <TableCell className="text-right">{data.by_type[r.id].users}</TableCell>
                    <TableCell className="text-right">{data.users_out_of_credits[r.id]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 font-semibold text-gray-800">Heaviest users</h3>
            {data.top_users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No generations in this period.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {data.top_users.map((u, i) => (
                  <li key={u.id} className="flex justify-between">
                    <span>{i + 1}. {u.username}</span>
                    <span className="font-medium">{u.generations}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Summarise an audit entry's details (before → after, resource ×amount, waitlist origin, reason) as one " · "-separated line. */
const describe = (details: Record<string, unknown>) => {
  const parts: string[] = [];
  if (details.before !== undefined && typeof details.before !== "object") parts.push(`${details.before} → ${details.after}`);
  if (details.resource_type) parts.push(`${details.resource_type}${details.amount ? ` ×${details.amount}` : ""}`);
  if (details.via === "waitlist") parts.push("from waitlist");
  if (details.reason) parts.push(`“${details.reason}”`);
  return parts.join(" · ");
};

/** Admin audit log tab: paginated table of admin actions with debounced search and an action-type filter. */
export function AuditTab() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("any");
  const [page, setPage] = useState(1);
  const query = useDebounced(q);
  const { data, error } = useAdminData(
    () => adminApi.audit({ q: query, action: action === "any" ? "" : action, page, page_size: 50 }), [query, action, page]);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input className="sm:max-w-xs" placeholder="Search admin or user" value={q}
               onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All actions</SelectItem>
            <SelectItem value="user.status">Status changes</SelectItem>
            <SelectItem value="user.role">Role changes</SelectItem>
            <SelectItem value="user.activate">Reactivations</SelectItem>
            <SelectItem value="user.deactivate">Deactivations</SelectItem>
            <SelectItem value="credits">Credit changes</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ErrorNote error={error} />
      <div className="rounded-md border overflow-x-auto">
        <Table data-testid="audit-table">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
              <TableHead className="hidden lg:table-cell">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.entries?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap">{fmtDate(a.created_at, true)}</TableCell>
                <TableCell>{a.actor}</TableCell>
                <TableCell>{ACTION_LABELS[a.action] ?? a.action}</TableCell>
                <TableCell>{a.target || "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{describe(a.details)}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{a.ip_address ?? "—"}</TableCell>
              </TableRow>
            ))}
            {data && data.entries?.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No admin actions yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
    </div>
  );
}
