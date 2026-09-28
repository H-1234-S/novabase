import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../db/drizzle.service.js';
import { orgMembers, organizations, users } from '../db/schema/index.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Injectable()
export class MembersService {
  constructor(private drizzle: DrizzleService) {}

  async getMembers(orgSlug: string) {
    return this.drizzle.db
      .select({
        id: orgMembers.id,
        role: orgMembers.role,
        createdAt: orgMembers.createdAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(eq(organizations.slug, orgSlug), isNull(orgMembers.removedAt)),
      );
  }

  async updateRole(orgSlug: string, memberId: string, dto: UpdateRoleDto) {
    if (dto.role === 'developer') {
      await this.ensureNotLastAdmin(orgSlug, memberId);
    }

    const [updated] = await this.drizzle.db
      .update(orgMembers)
      .set({ role: dto.role })
      .where(eq(orgMembers.id, memberId))
      .returning();

    if (!updated) throw new NotFoundException('Member not found');
    return updated;
  }

  async removeMember(orgSlug: string, memberId: string) {
    await this.ensureNotLastAdmin(orgSlug, memberId);

    const [updated] = await this.drizzle.db
      .update(orgMembers)
      .set({ removedAt: new Date() })
      .where(eq(orgMembers.id, memberId))
      .returning();

    if (!updated) throw new NotFoundException('Member not found');
    return { message: 'Member removed' };
  }

  // 非最后一位
  private async ensureNotLastAdmin(orgSlug: string, memberId: string) {
    const admins = await this.drizzle.db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(orgMembers.role, 'admin'),
          isNull(orgMembers.removedAt),
        ),
      );

    const targetIsAdmin = admins.some((a) => a.id === memberId);

    // 组织 member 只有一个并且是 admins
    if (targetIsAdmin && admins.length === 1) {
      throw new BadRequestException(
        'Cannot remove or demote the last admin of an organization',
      );
    }
  }
}
