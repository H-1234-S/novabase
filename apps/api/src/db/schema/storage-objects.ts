import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { storageBuckets } from './storage-buckets.js';

export const storageObjects = pgTable('storage_objects', {
  id: uuid().defaultRandom().primaryKey(),
  bucketId: uuid('bucket_id')
    .notNull()
    .references(() => storageBuckets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  mimeType: text('mime_type').notNull(),
  // 记录对应 UploadThing 云端的哪个文件
  utKey: text('ut_key').notNull(),
  // public 桶存 CDN 直链，private 桶存空字符串
  url: text('url').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type StorageObject = typeof storageObjects.$inferSelect;
export type NewStorageObject = typeof storageObjects.$inferInsert;
