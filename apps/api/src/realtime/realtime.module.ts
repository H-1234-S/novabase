import { Module } from '@nestjs/common';
import { RealtimeGateway } from './gateways/realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeController } from './realtime.controller.js';
import { TriggerService } from './trigger.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeService, TriggerService, OrgRoleGuard],
  controllers: [RealtimeController],
})
export class RealtimeModule {}
