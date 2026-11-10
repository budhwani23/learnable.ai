import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccountStatus } from "@/lib/types";
import type { AdminRole, AdminUser } from "@/lib/admin";

/** Load data, keep the last good value, and expose reload. Errors surface as a message. */
export function useAdminData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const value = await load();
      if (id === seq.current) { setData(value); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load data");
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

const STATUS_STYLE: Record<AccountStatus, string> = {
  approved: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  pending: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  rejected: "bg-gray-200 text-gray-700 hover:bg-gray-200",
  banned: "bg-red-100 text-red-700 hover:bg-red-100",
};
const STATUS_LABEL: Record<AccountStatus, string> = {
  approved: "Approved", pending: "Waitlist", rejected: "Rejected", banned: "Banned",
};

/** Account status badge (Approved/Waitlist/Rejected/Banned), plus a "Deactivated" badge when the user is inactive. */
export function StatusBadge({ user }: { user: Pick<AdminUser, "status" | "is_active"> }) {
  return (
    <span className="inline-flex gap-1">
      <Badge className={STATUS_STYLE[user.status]}>{STATUS_LABEL[user.status]}</Badge>
      {!user.is_active && <Badge variant="outline" className="border-red-300 text-red-700">Deactivated</Badge>}
    </span>
  );
}

const ROLE_STYLE: Record<AdminRole, string> = {
  admin: "bg-slate-800 text-white hover:bg-slate-800",
  teacher: "bg-indigo-100 text-indigo-700 hover:bg-indigo-100",
  student: "bg-sky-100 text-sky-700 hover:bg-sky-100",
};

/** Colour-coded badge showing a user's role with its first letter capitalised. */
export function RoleBadge({ role }: { role: AdminRole }) {
  return <Badge className={ROLE_STYLE[role]}>{role[0].toUpperCase() + role.slice(1)}</Badge>;
}

/**
 * Format an ISO timestamp in the user's locale ("—" when missing).
 * @param withTime Include the time of day as well as the date.
 */
export const fmtDate = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
};

/** Pagination footer showing the total count, current page and Previous/Next buttons that call `onPage`. */
export function Pager({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm text-muted-foreground">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Red error box for a load error message; renders nothing when `error` is null. */
export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>;
}

/** Debounce a text value (for search boxes). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const ACTION_LABELS: Record<string, string> = {
  "user.status.approved": "Approved user",
  "user.status.rejected": "Rejected user",
  "user.status.banned": "Banned user",
  "user.status.pending": "Moved to waitlist",
  "user.activate": "Reactivated user",
  "user.deactivate": "Deactivated user",
  "user.role": "Changed role",
  "credits.grant": "Granted credits",
  "credits.set": "Set credits",
  "credits.reset": "Reset credits",
};
