import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProjectApiService } from './project-api.service.js';
import { ProjectApiController } from './project-api.controller.js';
import { ProjectKeyGuard } from './guards/project-key.guard.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [ProjectApiService, ProjectKeyGuard],
  controllers: [ProjectApiController],
})
export class ProjectApiModule {}
