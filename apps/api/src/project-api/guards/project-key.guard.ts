import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PROJECT_KEY_ROLES } from '@novabase/constants';

export interface ProjectKeyPayload {
  projectId: string;
  role: typeof PROJECT_KEY_ROLES.ANON | typeof PROJECT_KEY_ROLES.SERVICE_ROLE;
}

export interface RequestProjectKey extends Request {
  projectKey: ProjectKeyPayload;
}

@Injectable()
export class ProjectKeyGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestProjectKey>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }

    const token = authHeader.slice(7);

    try {
      const payload = this.jwtService.verify<ProjectKeyPayload>(token, {
        secret: this.configService.get<string>('PROJECT_JWT_SECRET'),
      });

      request['projectKey'] = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid API key');
    }
  }
}
