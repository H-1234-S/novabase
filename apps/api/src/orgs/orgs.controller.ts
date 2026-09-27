import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrgsService } from './orgs.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '@novabase/types';
import type { CreateOrgDto } from './dto/create-org.dto.js';

@Controller('orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @Get()
  getMyOrgs(@CurrentUser() user: JwtPayload) {
    return this.orgsService.getMyOrgs(user.sub);
  }

  @Get(':slug')
  getOrgBySlug(@Param('slug') slug: string, @CurrentUser() user: JwtPayload) {
    return this.orgsService.getOrgBySlug(slug, user.sub);
  }

  @Post()
  createOrg(@Body() dto: CreateOrgDto, @CurrentUser() user: JwtPayload) {
    return this.orgsService.createOrg(dto, user.sub);
  }
}
