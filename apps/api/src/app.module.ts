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
import { TableEditorModule } from './table-editor/table-editor.module.js';
import { ProjectApiModule } from './project-api/project-api.module.js';
import { SqlEditorModule } from './sql-editor/sql-editor.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { StorageModule } from './storage/storage.module.js';

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
    TableEditorModule,
    ProjectApiModule,
    SqlEditorModule,
    RealtimeModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService, OrgsService],
})
export class AppModule {}
