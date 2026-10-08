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
import { StorageService } from './storage.service.js';
import { storageRouter } from './uploadthing.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';
import { CreateBucketDto } from './dto/create-bucket.dto.js';
import { SaveObjectDto } from './dto/save-object.dto.js';

// UploadThing 回调端点（挂在 /api/uploadthing，见下面的 UploadthingCallbackController）
const UPLOADTHING_CALLBACK_PATH = 'uploadthing';

const utHandler = createRouteHandler({
  router: storageRouter,
  config: {
    // 本地开发必须是 dev：此时 SDK 自己把 onUploadComplete / onUploadError 的 hook
    // 转发到 callbackUrl（UT 云端访问不到你的 localhost）；
    // 生产（NODE_ENV=production）则由 UT 云端回调 callbackUrl，必须是公网可达地址
    isDev: process.env.NODE_ENV !== 'production',

    // 不显式指定的话，SDK 会取「本次请求的 origin + pathname」，
    // 而下面把 req.url 改写成了 "/"，算出来就成了 http://localhost:3000/ —— 云端和本机都打不中真实路由
    callbackUrl:
      process.env.UPLOADTHING_CALLBACK_URL ??
      `http://localhost:${process.env.PORT ?? 3000}/api/${UPLOADTHING_CALLBACK_PATH}`,
  },
});

/**
 * 把请求交给 uploadthing/express 的 createRouteHandler。
 * uploadthing 的 express Router 挂载在 "/" 上，所以只保留 query、把 path 换成 "/"。
 */
function runUploadthingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
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
    runUploadthingHandler(req, res, next);
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

/**
 * UploadThing 回调端点。
 * 故意不加 JwtAuthGuard：UT 云端（生产）或 SDK 的 dev 转发都没有用户 cookie，
 * 请求体由 SDK 用 x-uploadthing-signature 校验，所以公开是安全的。
 */
@Controller(UPLOADTHING_CALLBACK_PATH)
export class UploadthingCallbackController {
  @All()
  handle(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): void {
    runUploadthingHandler(req, res, next);
  }
}
