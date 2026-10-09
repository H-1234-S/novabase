import { NovabaseClient } from './client';

export function createClient(
  projectUrl: string,
  apiKey: string,
): NovabaseClient {
  return new NovabaseClient(projectUrl, apiKey);
}

export { NovabaseClient } from './client';
export { QueryBuilder, NovabaseDb } from './db';
export type { QueryResult } from './db';
export { NovabaseRealtime } from './realtime';
export type { RealtimeCallback } from './realtime';
export { NovabaseStorage } from './storage';
export { NovabaseAuth } from './auth';
