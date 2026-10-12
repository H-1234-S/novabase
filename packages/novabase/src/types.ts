// Public types inlined so the published package is fully self-contained.
// (Keeps `novabase` from depending on the private @novabase/types workspace package.)

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeEvent {
  type: RealtimeEventType;
  table: string;
  record: Record<string, unknown>;
  /** only present on UPDATE and DELETE */
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
