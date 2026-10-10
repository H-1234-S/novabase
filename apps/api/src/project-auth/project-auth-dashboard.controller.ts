import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ProjectAuthService } from './project-auth.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';

@Controller('orgs/:slug/projects/:projectSlug/auth')
@UseGuards(JwtAuthGuard, OrgRoleGuard)
export class ProjectAuthDashboardController {
  constructor(private projectAuthService: ProjectAuthService) {}

  @Get('users')
  getUsers(@Param('projectSlug') projectSlug: string) {
    return this.projectAuthService.getUsers(projectSlug);
  }

  @Get('settings')
  getSettings(@Param('projectSlug') projectSlug: string) {
    return this.projectAuthService.getOAuthSettings(projectSlug);
  }

  @Post('settings')
  updateSettings(
    @Param('projectSlug') projectSlug: string,
    @Body()
    settings: {
      siteUrl?: string;
      googleClientId?: string;
      googleClientSecret?: string;
      githubClientId?: string;
      githubClientSecret?: string;
    },
  ) {
    return this.projectAuthService.updateOAuthSettings(projectSlug, settings);
  }
}
