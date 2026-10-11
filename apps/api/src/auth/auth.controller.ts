import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
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
import { OAuthHandoffService } from './oauth-handoff.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly inviteService: InviteService,
    private readonly oauthHandoffService: OAuthHandoffService,
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
    return res.redirect(this.buildWebHandoffUrl(tokens));
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
    return res.redirect(this.buildWebHandoffUrl(tokens));
  }

  /**
   * 用一次性 code 换 token。
   *
   * 由 web 的 /auth/callback 在服务端调用，换到 token 后写进 web 域的 Cookie。
   * code 只能消费一次，过期或已用过返回 401。
   */
  @Get('handoff/:code')
  consumeHandoff(@Param('code') code: string) {
    const tokens = this.oauthHandoffService.consume(code);
    if (!tokens) {
      throw new UnauthorizedException('Invalid or expired OAuth handoff code');
    }
    return tokens;
  }

  /**
   * OAuth 回调不直接种 Cookie（跨域时浏览器不会把 API 域的 Cookie 带给 web 域），
   * 而是生成一次性 code 跳回 web，由 web 自己换 token 并写 Cookie。
   */
  private buildWebHandoffUrl(tokens: {
    accessToken: string;
    refreshToken: string;
  }): string {
    const handoffCode = this.oauthHandoffService.create(tokens);
    const webUrl = this.configService.get<string>('WEB_URL');
    return `${webUrl}/auth/callback?code=${handoffCode}`;
  }

  @Get('invite/accept')
  async acceptInvite(@Query('token') token: string, @Res() res: Response) {
    await this.inviteService.acceptInvite(token);
    return res.redirect(`${this.configService.get('WEB_URL')}/dashboard`);
  }
}
