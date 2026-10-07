import {
  Controller,
  Delete,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { TriggerService } from './trigger.service.js';
import { DrizzleService } from '../db/drizzle.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';
import { projects, organizations } from '../db/schema/index.js';

@Controller('orgs/:slug/projects/:projectSlug/realtime')
@UseGuards(JwtAuthGuard, OrgRoleGuard)
export class RealtimeController {
  constructor(
    private triggerService: TriggerService,
    private drizzle: DrizzleService,
  ) {}

  private async getProject(orgSlug: string, projectSlug: string) {
    const [row] = await this.drizzle.db
      .select({ id: projects.id, dbSchema: projects.dbSchema })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  @Post(':tableName/enable')
  async enableRealtime(
    @Param('slug') slug: string,
    @Param('projectSlug') projectSlug: string,
    @Param('tableName') tableName: string,
  ) {
    const project = await this.getProject(slug, projectSlug);
    // 触发监听配置
    await this.triggerService.enableRealtime(
      project.dbSchema,
      project.id,
      tableName,
    );
    return { message: `Realtime enabled for ${tableName}` };
  }

  @Delete(':tableName/disable')
  async disableRealtime(
    @Param('slug') slug: string,
    @Param('projectSlug') projectSlug: string,
    @Param('tableName') tableName: string,
  ) {
    const project = await this.getProject(slug, projectSlug);
    await this.triggerService.disableRealtime(project.dbSchema, tableName);
    return { message: `Realtime disabled for ${tableName}` };
  }
}
