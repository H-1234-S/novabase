import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtModule } from '@nestjs/jwt';
import { DbModule } from '../db/db.module.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { MembersModule } from '../members/members.module.js';
import { OAuthHandoffService } from './oauth-handoff.service.js';

@Module({
  imports: [JwtModule.register({}), DbModule, MembersModule],
  controllers: [AuthController],
  providers: [AuthService, OAuthHandoffService, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
