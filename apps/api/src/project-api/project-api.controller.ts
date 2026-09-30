import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PROJECT_KEY_ROLES } from '@novabase/constants';
import { ProjectApiService } from './project-api.service.js';
import {
  ProjectKeyGuard,
  type ProjectKeyPayload,
  type RequestProjectKey,
} from './guards/project-key.guard.js';

@Controller('projects/:projectSlug/rest')
@UseGuards(ProjectKeyGuard)
export class ProjectApiController {
  constructor(private projectApiService: ProjectApiService) {}

  private getProjectKey(req: RequestProjectKey): ProjectKeyPayload {
    return req['projectKey'] as ProjectKeyPayload;
  }

  private assertWriteAccess(req: RequestProjectKey): void {
    const { role } = this.getProjectKey(req);
    if (role !== PROJECT_KEY_ROLES.SERVICE_ROLE) {
      throw new ForbiddenException(
        'Write operations require the service role key',
      );
    }
  }

  @Get(':table')
  getRows(
    @Req() req: RequestProjectKey,
    @Param('projectSlug') projectSlug: string,
    @Param('table') table: string,
    @Query() query: Record<string, string>,
  ) {
    const { projectId } = this.getProjectKey(req);
    return this.projectApiService.getRows(projectId, projectSlug, table, query);
  }

  @Post(':table')
  insertRow(
    @Req() req: RequestProjectKey,
    @Param('projectSlug') projectSlug: string,
    @Param('table') table: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);
    return this.projectApiService.insertRow(
      projectId,
      projectSlug,
      table,
      body,
    );
  }

  @Patch(':table/:id')
  updateRow(
    @Req() req: RequestProjectKey,
    @Param('projectSlug') projectSlug: string,
    @Param('table') table: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);
    return this.projectApiService.updateRow(
      projectId,
      projectSlug,
      table,
      id,
      body,
    );
  }

  @Delete(':table/:id')
  deleteRow(
    @Req() req: RequestProjectKey,
    @Param('projectSlug') projectSlug: string,
    @Param('table') table: string,
    @Param('id') id: string,
  ) {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);
    return this.projectApiService.deleteRow(projectId, projectSlug, table, id);
  }
}
