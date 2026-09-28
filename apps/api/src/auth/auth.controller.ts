import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { ConfigService } from '@nestjs/config';
import { RegisterDto } from './dto/register.dto.js';
import type { Response, Request } from 'express';
import { LoginDto } from './dto/login.dto.js';
import { COOKIE_KEYS } from '@novabase/constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from '@novabase/types';
import { InviteService } from '../members/invite.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly inviteService: InviteService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.register(dto);
    this.authService.setTokenCookies(res, tokens);
    return { message: 'Registered successfully' };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);
    this.authService.setTokenCookies(res, tokens);
    return { message: 'Logged in successfully' };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearTokenCookies(res);
    return { message: 'Logged out successfully' };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies[COOKIE_KEYS.REFRESH_TOKEN] as string;
    const tokens = await this.authService.refreshTokens(refreshToken);
    this.authService.setTokenCookies(res, tokens);
    return { message: 'Tokens refreshed' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }

  // 谷歌登录
  @Get('google')
  @Redirect()
  googleLogin() {
    return { url: this.authService.getGoogleAuthUrl() };
  }

  // 同意授权的回调
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Res() res: Response) {
    const tokens = await this.authService.handleGoogleCallback(code);
    this.authService.setTokenCookies(res, tokens);
    return res.redirect(
      `${this.configService.get<string>('WEB_URL')}/dashboard`,
    );
  }

  @Get('github')
  @Redirect()
  githubLogin() {
    // 动态重定向
    return { url: this.authService.getGithubAuthUrl() };
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    const tokens = await this.authService.handleGithubCallback(code);
    this.authService.setTokenCookies(res, tokens);
    return res.redirect(
      `${this.configService.get<string>('WEB_URL')}/dashboard`,
    );
  }

  @Get('invite/accept')
  async acceptInvite(@Query('token') token: string, @Res() res: Response) {
    await this.inviteService.acceptInvite(token);
    return res.redirect(`${this.configService.get('WEB_URL')}/dashboard`);
  }
}
