import { Injectable, NotFoundException } from '@nestjs/common';
import { DrizzleService } from '../db/drizzle.service.js';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { organizations, orgMembers, projects } from '../db/schema/index.js';
import { CreateOrgDto } from './dto/create-org.dto.js';
import slugify from 'slugify';

@Injectable()
export class OrgsService {
  constructor(private readonly drizzle: DrizzleService) {}

  private generateOrgSlug(name: string): string {
    const base = slugify(`${name}-org`, { lower: true, strict: true });
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  async getMyOrgs(userId: string) {
    return this.drizzle.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: orgMembers.role,
        projectCount: sql<number>`cast(count(distinct ${projects.id}) as int)`,
        memberCount: sql<number>`(
          select cast(count(*) as int)
          from org_members om
          where om.org_id = ${organizations.id}
            and om.removed_at is null
        )`,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .leftJoin(projects, eq(projects.orgId, organizations.id))
      .where(and(eq(orgMembers.userId, userId), isNull(orgMembers.removedAt)))
      .groupBy(organizations.id, orgMembers.role);
  }

  async getOrgBySlug(slug: string, userId: string) {
    const [row] = await this.drizzle.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.orgId, organizations.id),
          eq(orgMembers.userId, userId),
          isNull(orgMembers.removedAt),
        ),
      )
      .where(eq(organizations.slug, slug))
      .limit(1);

    if (!row) throw new NotFoundException('Organization not found');
    return row;
  }

  // 创建组织
  async createOrg(dto: CreateOrgDto, userId: string) {
    const [org] = await this.drizzle.db
      .insert(organizations)
      .values({
        name: dto.name,
        slug: this.generateOrgSlug(dto.name),
      })
      .returning();

    await this.drizzle.db.insert(orgMembers).values({
      orgId: org.id,
      userId,
      role: 'admin',
    });

    return org;
  }
}
