import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import slugify from 'slugify';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DrizzleService } from '../db/drizzle.service.js';
import { projects, organizations, orgMembers } from '../db/schema/index.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { PROJECT_KEY_ROLES } from '@novabase/constants';

@Injectable()
export class ProjectsService {
  constructor(
    private drizzle: DrizzleService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // Utils
  private generateProjectSlug(name: string): string {
    const base = slugify(name, { lower: true, strict: true });
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  // 生成 dbSchema
  private generateDbSchema(): string {
    return `proj_${randomBytes(4).toString('hex')}`;
  }

  private signProjectKey(projectId: string, role: string): string {
    // 签发项目密钥
    return this.jwtService.sign(
      { projectId, role },
      {
        secret: this.configService.get<string>('PROJECT_JWT_SECRET'),
        // 项目密钥不会过期——一旦泄露将手动轮换
        expiresIn: '100y',
      },
    );
  }

  private async provisionSchema(dbSchema: string): Promise<void> {
    // 在数据库中创建一个命名空间
    // IF NOT EXISTS 幂等操作
    await this.drizzle.db.execute(`CREATE SCHEMA IF NOT EXISTS "${dbSchema}"`);
  }

  async getProjectsForOrg(orgSlug: string, userId: string) {
    return this.drizzle.db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        projectUrl: projects.projectUrl,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.orgId, organizations.id),
          eq(orgMembers.userId, userId),
          isNull(orgMembers.removedAt),
        ),
      )
      .where(eq(organizations.slug, orgSlug));
  }

  // 获取某一具体项目
  async getProjectBySlug(orgSlug: string, projectSlug: string, userId: string) {
    const [row] = await this.drizzle.db
      .select()
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.orgId, organizations.id),
          eq(orgMembers.userId, userId),
          isNull(orgMembers.removedAt),
        ),
      )
      .where(
        and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  // 创建项目
  async createProject(orgSlug: string, dto: CreateProjectDto) {
    // 项目是挂载到组织上的
    const [org] = await this.drizzle.db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found');

    // 获取项目 slug
    const projectSlug = this.generateProjectSlug(dto.name);
    // 生成数据库 schema
    const dbSchema = this.generateDbSchema();
    // 项目 URL
    const projectUrl = `${this.configService.get<string>('API_URL')}/projects/${projectSlug}`;

    // 配置项目 schema
    await this.provisionSchema(dbSchema);

    // TODO:DELETE
    const authJwtSecret = randomBytes(32).toString();

    const [project] = await this.drizzle.db
      .insert(projects)
      .values({
        orgId: org.id,
        name: dto.name,
        slug: projectSlug,
        dbSchema,
        projectUrl,
        anonKey: '',
        serviceRoleKey: '',
        authJwtSecret,
      })
      .returning();

    // 生成 key
    const anonKey = this.signProjectKey(project.id, PROJECT_KEY_ROLES.ANON);
    const serviceRoleKey = this.signProjectKey(
      project.id,
      PROJECT_KEY_ROLES.SERVICE_ROLE,
    );

    const [updated] = await this.drizzle.db
      .update(projects)
      .set({ anonKey, serviceRoleKey })
      .where(eq(projects.id, project.id))
      .returning();

    return updated;
  }
}
