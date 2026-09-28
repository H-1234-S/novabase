import { IsEnum } from 'class-validator';
import { ORG_ROLES } from '@novabase/constants';
import type { OrgRole } from '@novabase/types';

export class UpdateRoleDto {
  @IsEnum(ORG_ROLES)
  role: OrgRole;
}
