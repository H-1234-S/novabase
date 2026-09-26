import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import slugify from 'slugify';
import { eq } from 'drizzle-orm';
import { COOKIE_KEYS } from '@novabase/constants';
import { JwtPayload } from '@novabase/types';
import { users, organizations, orgMembers } from '../db/schema/index.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { InjectDrizzle } from '@nestjs/drizzle';
import { DrizzleService } from '../db/drizzle.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectDrizzle()
    private db: DrizzleService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}
}
