import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // 全局路由前缀
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,

      // 将 whitelist 的静默处理改为抛出异常
      forbidNonWhitelisted: true,
    }),
  );

  // 配置跨域
  app.enableCors({
    // 允许的源
    origin: process.env.WEB_URL ?? 'http://localhost:3001',
    // 允许浏览器发送 Cookie 或 Authorization 头
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;

  await app.listen(port);
}
await bootstrap();
