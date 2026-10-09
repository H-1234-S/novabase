import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  Next,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PROJECT_KEY_ROLES } from '@novabase/constants';
import { createRouteHandler } from 'uploadthing/express';
import { StorageService } from './storage.service.js';
import { storageRouter } from './uploadthing.js';
import {
  ProjectKeyGuard,
  type ProjectKeyPayload,
} from '../project-api/guards/project-key.guard.js';
import { ForbiddenException } from '@nestjs/common';
import { SaveObjectDto } from './dto/save-object.dto.js';

const utHandler = createRouteHandler({ router: storageRouter });

// 该 controller 用于 handle JavaScript-SDK
@Controller('projects/:projectSlug/storage')
@UseGuards(ProjectKeyGuard)
export class ProjectStorageController {
  constructor(private storageService: StorageService) {}

  private getProjectKey(req: Request): ProjectKeyPayload {
    return (req as Request & { projectKey: ProjectKeyPayload })['projectKey'];
  }

  // Write 操作鉴权
  private assertWriteAccess(req: Request): void {
    const { role } = this.getProjectKey(req);
    if (role !== PROJECT_KEY_ROLES.SERVICE_ROLE) {
      throw new ForbiddenException(
        'Write operations require the service role key',
      );
    }
  }

  @Get('buckets/:bucketName/objects')
  async getObjects(
    @Req() req: Request,
    @Param('projectSlug') projectSlug: string,
    @Param('bucketName') bucketName: string,
  ) {
    const { projectId } = this.getProjectKey(req);
    await this.storageService.assertProjectSlug(projectId, projectSlug);
    const bucket = await this.storageService.getBucketByName(
      projectId,
      bucketName,
    );
    return this.storageService.getObjects(bucket.id);
  }

  // 相当于 middleware 进行鉴权再转发
  @All('buckets/:bucketName/upload')
  async handleUpload(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
    @Param('projectSlug') projectSlug: string,
    @Param('bucketName') bucketName: string,
  ): Promise<void> {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);

    // 校验
    await this.storageService.assertProjectSlug(projectId, projectSlug);
    await this.storageService.getBucketByName(projectId, bucketName);

    const originalUrl = req.url;
    const queryIndex = originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';
    req.url = `/${query}`;

    utHandler(req, res, (err?: unknown) => {
      req.url = originalUrl;
      if (err) next(err);
    });
  }

  @Post('buckets/:bucketName/objects')
  async saveObject(
    @Req() req: Request,
    @Param('projectSlug') projectSlug: string,
    @Param('bucketName') bucketName: string,
    @Body() file: SaveObjectDto,
  ) {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);
    await this.storageService.assertProjectSlug(projectId, projectSlug);
    const bucket = await this.storageService.getBucketByName(
      projectId,
      bucketName,
    );
    return this.storageService.saveObject(bucket.id, file);
  }

  @Delete('objects/:objectId')
  async deleteObject(
    @Req() req: Request,
    @Param('projectSlug') projectSlug: string,
    @Param('objectId') objectId: string,
  ) {
    this.assertWriteAccess(req);
    const { projectId } = this.getProjectKey(req);
    await this.storageService.assertProjectSlug(projectId, projectSlug);
    return this.storageService.deleteObject(objectId);
  }

  @Get('objects/:objectId/signed-url')
  async getSignedUrl(
    @Req() req: Request,
    @Param('projectSlug') projectSlug: string,
    @Param('objectId') objectId: string,
  ) {
    const { projectId } = this.getProjectKey(req);
    await this.storageService.assertProjectSlug(projectId, projectSlug);
    return this.storageService.getSignedUrl(objectId);
  }
}
