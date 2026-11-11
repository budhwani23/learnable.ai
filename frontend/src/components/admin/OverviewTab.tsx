import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/admin";
import { RESOURCE_TYPES } from "@/lib/types";
import { ErrorNote, useAdminData } from "./common";

/** Stat card with a label, big value and optional hint; becomes a keyboard-accessible button when `onClick` is given. */
function Stat({ label, value, hint, onClick }: { label: string; value: number | string; hint?: string; onClick?: () => void }) {
  return (
    <Card
      className={`p-4 ${onClick ? "cursor-pointer hover:border-emerald-400 transition-colors" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      } : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/**
 * Admin overview: headline user/generation stats, a daily activity chart for the chosen
 * range (7/30/90 days) and all-time generations per resource type.
 * @param onOpenWaitlist Called when the Waitlist stat card is clicked.
 */
export default function OverviewTab({ onOpenWaitlist }: { onOpenWaitlist: () => void }) {
  const [days, setDays] = useState("30");
  const { data, error, loading } = useAdminData(() => adminApi.stats(Number(days)), [days]);
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="admin-stats">
          <Stat label="Users" value={t.users} hint={`${t.teachers} teachers · ${t.students} students · ${t.admins} admins`} />
          <Stat label="Waitlist" value={t.pending} hint="Click to review" onClick={onOpenWaitlist} />
          <Stat label="Signups (7 days)" value={t.signups_7d} />
          <Stat label="Active users" value={t.active_7d} hint={`${t.active_1d} today · ${t.active_30d} in 30 days`} />
          <Stat label="Generations" value={t.generations} hint={`${t.generations_today} today`} />
          <Stat label="Approved" value={t.approved} />
          <Stat label="Rejected / banned" value={`${t.rejected} / ${t.banned}`} />
          <Stat label="Deactivated" value={t.deactivated} />
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-800">Activity per day</h3>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="h-64">
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="generations" name="Generations" stroke="#059669" fill="#05966933" />
                <Area type="monotone" dataKey="active_users" name="Active users" stroke="#4f46e5" fill="#4f46e522" />
                <Area type="monotone" dataKey="signups" name="Signups" stroke="#d97706" fill="#d9770622" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {data && (
        <Card className="p-4">
          <h3 className="mb-3 font-semibold text-gray-800">Generations by resource (all time)</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {RESOURCE_TYPES.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{r.label}</p>
                <p className="text-xl font-semibold">{data.generations_by_type[r.id] ?? 0}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
