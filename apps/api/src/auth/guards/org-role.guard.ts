import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service.js';
import { organizations, orgMembers } from '../../db/schema/index.js';
import { ORG_ROLE_KEY } from '../decorators/require-org-role.decorator.js';
import type { OrgRole, JwtPayload } from '@novabase/types';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  memberRole?: string;
}

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private drizzle: DrizzleService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.get<OrgRole>(
      ORG_ROLE_KEY,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const orgSlug = request.params['slug'] as string;

    const [member] = await this.drizzle.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(orgMembers.userId, user.sub),
          isNull(orgMembers.removedAt),
        ),
      )
      .limit(1);

    if (!member) throw new NotFoundException('Organization not found');

    if (requiredRole && member.role !== requiredRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    request.memberRole = member.role;
    return true;
  }
}
