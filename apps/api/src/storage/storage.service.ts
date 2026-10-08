import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { UTApi } from 'uploadthing/server';
import { DrizzleService } from '../db/drizzle.service.js';
import {
  projects,
  organizations,
  storageBuckets,
  storageObjects,
} from '../db/schema/index.js';
import type { BucketAccess } from '@novabase/types';

@Injectable()
export class StorageService {
  private utapi = new UTApi();

  constructor(private drizzle: DrizzleService) {}

  private async getProject(orgSlug: string, projectSlug: string) {
    const [row] = await this.drizzle.db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  async getBuckets(orgSlug: string, projectSlug: string) {
    const project = await this.getProject(orgSlug, projectSlug);
    return this.drizzle.db
      .select()
      .from(storageBuckets)
      .where(eq(storageBuckets.projectId, project.id));
  }

  async createBucket(
    orgSlug: string,
    projectSlug: string,
    name: string,
    access: BucketAccess,
  ) {
    const project = await this.getProject(orgSlug, projectSlug);

    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Bucket name is required');
    }

    const [bucket] = await this.drizzle.db
      .insert(storageBuckets)
      .values({ projectId: project.id, name: trimmed, access })
      .returning();

    return bucket;
  }

  async deleteBucket(bucketId: string) {
    const objects = await this.drizzle.db
      .select({ utKey: storageObjects.utKey })
      .from(storageObjects)
      .where(eq(storageObjects.bucketId, bucketId));

    if (objects.length > 0) {
      await this.utapi.deleteFiles(objects.map((o) => o.utKey));
    }

    await this.drizzle.db
      .delete(storageBuckets)
      .where(eq(storageBuckets.id, bucketId));

    return { message: 'Bucket deleted' };
  }

  async getObjects(bucketId: string) {
    return this.drizzle.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.bucketId, bucketId));
  }

  async saveObject(
    bucketId: string,
    file: {
      name: string;
      size: number;
      type: string;
      utKey: string;
      url: string;
    },
  ) {
    const [bucket] = await this.drizzle.db
      .select()
      .from(storageBuckets)
      .where(eq(storageBuckets.id, bucketId))
      .limit(1);

    if (!bucket) throw new NotFoundException('Bucket not found');

    const url = bucket.access === 'public' ? file.url : '';

    const [object] = await this.drizzle.db
      .insert(storageObjects)
      .values({
        bucketId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        utKey: file.utKey,
        url,
      })
      .returning();

    return object;
  }

  async deleteObject(objectId: string) {
    const [object] = await this.drizzle.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.id, objectId))
      .limit(1);

    if (!object) throw new NotFoundException('File not found');

    await this.utapi.deleteFiles(object.utKey);

    await this.drizzle.db
      .delete(storageObjects)
      .where(eq(storageObjects.id, objectId));

    return { message: 'File deleted' };
  }

  // 获得单个 storage object url
  async getSignedUrl(objectId: string) {
    const [object] = await this.drizzle.db
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.id, objectId))
      .limit(1);

    if (!object) throw new NotFoundException('File not found');

    const { ufsUrl } = await this.utapi.generateSignedURL(object.utKey, {
      expiresIn: 3600,
    });

    return { url: ufsUrl };
  }
}
