import type { Access } from '../../module-sdk/src/browser.js';
import type { Config } from './config.js';
export function accessFor(config: Config, userId: string, roles: string[], isMember: boolean): Access | null {
  if (!isMember) return null;
  if (config.OWNER_USER_IDS.includes(userId)) return 'owner';
  if (roles.some(role => config.DASHBOARD_ADMIN_ROLE_IDS.includes(role))) return 'admin';
  if (roles.some(role => config.DASHBOARD_VIEWER_ROLE_IDS.includes(role))) return 'viewer';
  return null;
}
export function canMutate(access: Access): boolean { return access === 'owner' || access === 'admin'; }
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
