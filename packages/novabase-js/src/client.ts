import { NovabaseDb } from './db';
import { NovabaseRealtime } from './realtime';
import { NovabaseStorage } from './storage';
import { NovabaseAuth } from './auth';

export class NovabaseClient {
  readonly db: NovabaseDb;
  readonly realtime: NovabaseRealtime;
  readonly storage: NovabaseStorage;
  readonly auth: NovabaseAuth;

  constructor(
    private projectUrl: string,
    private apiKey: string,
  ) {
    this.db = new NovabaseDb(projectUrl, apiKey);
    this.realtime = new NovabaseRealtime(projectUrl, apiKey);
    this.storage = new NovabaseStorage(projectUrl, apiKey);
    this.auth = new NovabaseAuth(projectUrl, apiKey);
  }

  from<T = Record<string, unknown>>(table: string) {
    return this.db.from<T>(table);
  }
}
