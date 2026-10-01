import { z } from 'zod';
export const secretScopeSchema = z.object({ moduleId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/) });
export const secretSetSchema = secretScopeSchema.extend({ expected: z.number().int().min(0).max(2147483646), mode: z.enum(['stored', 'disabled', 'environment']), ciphertext: z.string().regex(/^[A-Za-z0-9_-]{32,40000}$/).nullable() })
  .refine(value => value.mode === 'stored' ? value.ciphertext !== null : value.ciphertext === null);
