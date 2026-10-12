import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { COOKIE_KEYS } from '@novabase/constants';
import { JwtPayload } from '@novabase/types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const token = request.cookies?.[COOKIE_KEYS.ACCESS_TOKEN] as
      string | undefined;

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      // 对 token 进行校验，不正确直接抛出错误
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
      // request['user'] = payload;
      (request as Request & { user: JwtPayload })['user'] = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
