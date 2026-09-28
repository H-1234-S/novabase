import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembersService } from './members.service.js';
import { InviteService } from './invite.service.js';
import { MembersController } from './members.controller.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [MembersService, InviteService],
  controllers: [MembersController],
  exports: [InviteService],
})
export class MembersModule {}
