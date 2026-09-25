/** Provider-independent module storage. Scope is supplied by the host, never by a request. */
export interface ModuleRecord<T = unknown> { key: string; value: T; revision: number; updatedAt: string }
export interface RecordPage { records: ModuleRecord[]; nextCursor: string | null }
export interface ModuleData {
  get<T = unknown>(key: string): Promise<ModuleRecord<T> | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<RecordPage>;
  put<T>(key: string, value: T, expectedRevision: number, ttlMs?: number): Promise<ModuleRecord<T>>;
  delete(key: string, expectedRevision: number): Promise<boolean>;
}
export interface JobOptions { delayMs?: number; ttlMs?: number }
export interface ModuleJobs {
  enqueue(type: string, payload: unknown, key: string, options?: JobOptions): Promise<string>;
}
export interface ModuleJob { id: string; type: string; payload: unknown; attempt: number }
export interface ModuleResources { data: ModuleData; jobs: ModuleJobs }
