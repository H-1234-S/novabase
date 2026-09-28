import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrgsService } from './orgs/orgs.service.js';
import { OrgsModule } from './orgs/orgs.module.js';
import { MembersModule } from './members/members.module.js';
import { ProjectsModule } from './projects/projects.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    DbModule,
    OrgsModule,
    MembersModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [AppService, OrgsService],
})
export class AppModule {}
