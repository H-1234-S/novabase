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
import { createRouteHandler } from 'uploadthing/express';
import { IsNumber, IsEnum, IsString } from 'class-validator';
import { StorageService } from './storage.service.js';
import { storageRouter } from './uploadthing.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';
import { CreateBucketDto } from './dto/create-bucket.dto.js';
import { SaveObjectDto } from './dto/save-object.dto.js';

const utHandler = createRouteHandler({ router: storageRouter });

@Controller('orgs/:slug/projects/:projectSlug/storage')
@UseGuards(JwtAuthGuard, OrgRoleGuard)
export class StorageController {
  constructor(private storageService: StorageService) {}

  @Get('buckets')
  getBuckets(
    @Param('slug') slug: string,
    @Param('projectSlug') projectSlug: string,
  ) {
    return this.storageService.getBuckets(slug, projectSlug);
  }

  @Post('buckets')
  createBucket(
    @Param('slug') slug: string,
    @Param('projectSlug') projectSlug: string,
    @Body() dto: CreateBucketDto,
  ) {
    return this.storageService.createBucket(
      slug,
      projectSlug,
      dto.name,
      dto.access,
    );
  }

  @Delete('buckets/:bucketId')
  deleteBucket(@Param('bucketId') bucketId: string) {
    return this.storageService.deleteBucket(bucketId);
  }

  @Get('buckets/:bucketId/objects')
  getObjects(@Param('bucketId') bucketId: string) {
    return this.storageService.getObjects(bucketId);
  }

  // UploadThing 上传端点 — 代理 UT 协议（GET + POST）
  @All('buckets/:bucketId/upload')
  handleUpload(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): void {
    const originalUrl = req.url;
    const queryIndex = originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';

    // 把 /api/orgs/x/projects/y/storage/buckets/123/upload?slug=xxx
    // 改写成 /?slug=xxx —— 因为 UploadThing 的 handler 期望自己挂在根路径
    req.url = `/${query}`;

    // 交给 uploadthing/express 的 createRouteHandler
    utHandler(req, res, (err?: unknown) => {
      req.url = originalUrl;
      if (err) next(err);
    });
  }

  @Post('buckets/:bucketId/objects')
  saveObject(@Param('bucketId') bucketId: string, @Body() file: SaveObjectDto) {
    return this.storageService.saveObject(bucketId, file);
  }

  @Delete('objects/:objectId')
  deleteObject(@Param('objectId') objectId: string) {
    return this.storageService.deleteObject(objectId);
  }

  @Get('objects/:objectId/signed-url')
  getSignedUrl(@Param('objectId') objectId: string) {
    return this.storageService.getSignedUrl(objectId);
  }
}
