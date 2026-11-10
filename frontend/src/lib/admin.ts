// admin.ts — client for the admin panel API (/api/admin/*). Every route is admin-only on the server.
import api from './api';
import type { AccountStatus, Credits, ResourceType } from './types';

export type AdminRole = 'student' | 'teacher' | 'admin';

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  name: string;
  role: AdminRole;
  status: AccountStatus;
  status_reason: string;
  is_active: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string | null;
  generations: number | null;
  credits: Credits;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor: string;
  actor_id: number | null;
  action: string;
  target: string;
  target_id: number | null;
  details: Record<string, unknown>;
  ip_address: string | null;
}

export interface AdminUserDetail extends AdminUser {
  status_changed_at: string | null;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  usage: Record<ResourceType, { charged: number; refunded: number }>;
  recent_generations: { id: number; resource_type: ResourceType; created_at: string; refunded: boolean }[];
  audit: AuditEntry[];
}

export interface Page<T> { total: number; page: number; page_size: number; users?: T[]; entries?: T[] }

export interface AdminStats {
  totals: Record<
    'users' | 'admins' | 'deactivated' | 'pending' | 'approved' | 'rejected' | 'banned' | 'teachers' | 'students'
    | 'active_1d' | 'active_7d' | 'active_30d' | 'generations' | 'generations_today' | 'signups_7d', number>;
  generations_by_type: Partial<Record<ResourceType, number>>;
  series: { date: string; signups: number; generations: number; active_users: number }[];
}

export interface AdminUsage {
  days: number;
  by_type: Record<ResourceType, { charged: number; refunded: number; users: number }>;
  users_out_of_credits: Record<ResourceType, number>;
  top_users: { id: number; username: string; generations: number }[];
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const adminApi = {
  stats: (days = 30) => api.authorizedRequest<AdminStats>('GET', `/admin/stats${qs({ days })}`),
  users: (params: { q?: string; status?: string; role?: string; active?: string; page?: number; page_size?: number; sort?: string }) =>
    api.authorizedRequest<Page<AdminUser>>('GET', `/admin/users${qs(params)}`),
  user: (id: number) => api.authorizedRequest<AdminUserDetail>('GET', `/admin/users/${id}`),
  setStatus: (id: number, status: AccountStatus, reason = '') =>
    api.authorizedRequest<{ user: AdminUser }>('POST', `/admin/users/${id}/status`, { status, reason }),
  setActive: (id: number, active: boolean) =>
    api.authorizedRequest<{ user: AdminUser }>('POST', `/admin/users/${id}/active`, { active }),
  setRole: (id: number, role: AdminRole) =>
    api.authorizedRequest<{ user: AdminUser }>('POST', `/admin/users/${id}/role`, { role }),
  changeCredits: (id: number, action: 'grant' | 'set' | 'reset', resource_type: ResourceType | 'all', amount = 0) =>
    api.authorizedRequest<{ credits: Credits }>('POST', `/admin/users/${id}/credits`, { action, resource_type, amount }),
  waitlist: (params: { q?: string; page?: number; page_size?: number }) =>
    api.authorizedRequest<Page<AdminUser>>('GET', `/admin/waitlist${qs(params)}`),
  bulkWaitlist: (user_ids: number[], action: 'approve' | 'reject', reason = '') =>
    api.authorizedRequest<{ updated: number; skipped: number }>('POST', '/admin/waitlist/bulk', { user_ids, action, reason }),
  usage: (days = 30) => api.authorizedRequest<AdminUsage>('GET', `/admin/usage${qs({ days })}`),
  audit: (params: { q?: string; action?: string; page?: number; page_size?: number }) =>
    api.authorizedRequest<Page<AuditEntry>>('GET', `/admin/audit${qs(params)}`),
};
