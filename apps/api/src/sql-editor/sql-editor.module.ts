import { Module } from '@nestjs/common';
import { SqlEditorService } from './sql-editor.service.js';
import { SqlEditorController } from './sql-editor.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgRoleGuard } from '../auth/guards/org-role.guard.js';

@Module({
  imports: [AuthModule],
  providers: [SqlEditorService, OrgRoleGuard],
  controllers: [SqlEditorController],
})
export class SqlEditorModule {}
