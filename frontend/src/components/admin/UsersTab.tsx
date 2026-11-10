import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/lib/admin";
import { RESOURCE_TYPES } from "@/lib/types";
import { ErrorNote, Pager, RoleBadge, StatusBadge, fmtDate, useAdminData, useDebounced } from "./common";
import UserDetailSheet from "./UserDetailSheet";

const PAGE_SIZE = 25;

export default function UsersTab() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("any");
  const [role, setRole] = useState("any");
  const [active, setActive] = useState("any");
  const [sort, setSort] = useState("-date_joined");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const query = useDebounced(q);
  const params = {
    q: query, page, page_size: PAGE_SIZE, sort,
    status: status === "any" ? "" : status, role: role === "any" ? "" : role, active: active === "any" ? "" : active,
  };
  const { data, error, loading, reload } = useAdminData(() => adminApi.users(params), [JSON.stringify(params)]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search username, email or name" value={q}
                 onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="user-search" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={reset(setStatus)}>
            <SelectTrigger className="w-36" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any status</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Waitlist</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={reset(setRole)}>
            <SelectTrigger className="w-32" aria-label="Role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any role</SelectItem>
              <SelectItem value="student">Students</SelectItem>
              <SelectItem value="teacher">Teachers</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
          <Select value={active} onValueChange={reset(setActive)}>
            <SelectTrigger className="w-36" aria-label="Active"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Active + inactive</SelectItem>
              <SelectItem value="true">Active only</SelectItem>
              <SelectItem value="false">Deactivated</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={reset(setSort)}>
            <SelectTrigger className="w-40" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="-date_joined">Newest first</SelectItem>
              <SelectItem value="date_joined">Oldest first</SelectItem>
              <SelectItem value="-last_login">Recently active</SelectItem>
              <SelectItem value="-generation_count">Most generations</SelectItem>
              <SelectItem value="username">Username A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
              <TableHead className="hidden lg:table-cell">Last active</TableHead>
              <TableHead className="text-right">Generations</TableHead>
              <TableHead className="hidden xl:table-cell">Credits left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.users?.map((u) => (
              <TableRow key={u.id}
                        className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        tabIndex={0} aria-label={`Open ${u.username}`}
                        onClick={() => setSelected(u.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(u.id); }
                        }}
                        data-testid={`user-row-${u.username}`}>
                <TableCell>
                  <div className="font-medium">{u.username}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell><RoleBadge role={u.role} /></TableCell>
                <TableCell><StatusBadge user={u} /></TableCell>
                <TableCell className="hidden md:table-cell">{fmtDate(u.date_joined)}</TableCell>
                <TableCell className="hidden lg:table-cell">{fmtDate(u.last_login)}</TableCell>
                <TableCell className="text-right">{u.generations ?? 0}</TableCell>
                <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                  {RESOURCE_TYPES.map(r => (
                    <span key={r.id} className={u.credits[r.id].remaining === 0 ? "text-red-600" : ""} title={r.label}>
                      {r.label.split(" ")[0].slice(0, 5)} {u.credits[r.id].remaining}{" "}
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
            {data && data.users?.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No users match.</TableCell></TableRow>
            )}
            {loading && !data && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
      <UserDetailSheet userId={selected} onClose={() => setSelected(null)} onChanged={reload} />
    </div>
  );
}
