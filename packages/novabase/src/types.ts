// Public types inlined so the published package is fully self-contained.
// (Keeps `novabase` from depending on the private @novabase/types workspace package.)

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeEvent {
  version?: 1;
  /** PostgreSQL bigint cursor encoded as a decimal string. */
  seq: string;
  type: RealtimeEventType;
  table: string;
  /** Realtime sends invalidation events, not row contents. */
  record?: Record<string, unknown> | null;
  /** Legacy row data is omitted by current invalidation events. */
  oldRecord?: Record<string, unknown>;
  projectId: string;
  timestamp: string;
}

export type BucketAccess = 'public' | 'private';

export interface StorageObject {
  id: string;
  bucketId: string;
  name: string;
  size: number;
  mimeType: string;
  /** UploadThing file key — used to delete or to fetch a signed URL */
  utKey: string;
  /** public URL for public buckets, empty string for private buckets */
  url: string;
  createdAt: string;
}
