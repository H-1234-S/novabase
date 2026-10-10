import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProjectAuthService } from './project-auth.service.js';
import { ProjectAuthController } from './project-auth.controller.js';
import { ProjectAuthDashboardController } from './project-auth-dashboard.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [JwtModule.register({}), AuthModule],
  providers: [ProjectAuthService],
  controllers: [ProjectAuthController, ProjectAuthDashboardController],
})
export class ProjectAuthModule {}
