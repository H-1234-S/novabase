import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import {
  StorageController,
  UploadthingCallbackController,
} from './storage.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectStorageController } from './project-storage.controller.js';
import { JwtModule } from '@nestjs/jwt';
import { ProjectKeyGuard } from '../project-api/guards/project-key.guard.js';

@Module({
  imports: [AuthModule, JwtModule.register({})],
  providers: [StorageService, ProjectKeyGuard],
  controllers: [
    StorageController,
    UploadthingCallbackController,
    ProjectStorageController,
  ],
})
export class StorageModule {}
