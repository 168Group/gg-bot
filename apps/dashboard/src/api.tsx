import { createContext, useContext } from 'react';
import type { UserSession } from '../../../packages/module-sdk/src/browser.js';
export const SessionContext = createContext<UserSession | null>(null);
export function useSession(): UserSession { const session = useContext(SessionContext); if (!session) throw new Error('Session required.'); return session; }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json();
  if (!response.ok) throw new ApiError(json.error?.message ?? 'Request failed.', response.status);
  return json.data as T;
}
export interface Status {
  storageProvider: 'postgres' | 'pocketbase';
  online: boolean; health: { heartbeat: string; status: string; details: { gateway: boolean; persistenceFailures?: number } } | null;
  queue: { state: string; count: number; oldest: string }[];
  incidents: { id: string; started_at: string; reason: string; dropped_count: number | null }[];
  eventCount: number; capabilities: Record<string, boolean>;
}
