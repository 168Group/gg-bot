import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export const opaque = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class TokenVault {
  private key: Buffer;
  constructor(key: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('SESSION_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
    this.key = Buffer.from(key, 'hex');
  }
  csrf(sessionId: string): string { return createHmac('sha256', this.key).update(`csrf:${sessionId}`).digest('base64url'); }
  encrypt(value: unknown): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }
  decrypt<T>(value: string): T {
    const data = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()) as T;
  }
}
