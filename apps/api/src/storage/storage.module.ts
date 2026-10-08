import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import {
  StorageController,
  UploadthingCallbackController,
} from './storage.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [StorageService],
  controllers: [StorageController, UploadthingCallbackController],
})
export class StorageModule {}
