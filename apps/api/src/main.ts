import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  setGlobalDispatcher,
} from 'undici';
import { IoAdapter } from '@nestjs/platform-socket.io';

// 出站代理：只在环境里真的配了代理时才启用，并且尊重 NO_PROXY（localhost 直连，回调自己不打代理）
// 注意：不要硬编码 http://127.0.0.1:7897 —— 代理没开/换端口/WSL/容器里，
// 这个全局 dispatcher 会让所有出站请求（上传元数据登记、邮件、数据库 HTTP 等）一起挂掉
const outboundProxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;

if (outboundProxy) {
  const noProxy = [
    ...new Set(
      `${process.env.NO_PROXY ?? ''},localhost,127.0.0.1,::1`
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].join(',');

  setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }));

  // 关键：dispatcher 和 fetch 必须来自同一个 undici 版本。
  // Node 内建的 fetch 会把 content-length 交给 npm undici@8 的 Client 校验，
  // 被判成 "invalid content-length header"（UND_ERR_INVALID_ARG, fetch failed），
  // 于是所有带 body 的服务端请求（uploadthing 的 /route-metadata、/callback-result）都会失败。
  globalThis.fetch = undiciFetch as unknown as typeof fetch;

  console.log(`[net] 出站代理: ${outboundProxy} (no_proxy: ${noProxy})`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));

  app.use(cookieParser());

  // API Doc
  const config = new DocumentBuilder()
    .setTitle('novabase')
    .setDescription('The novabase API description')
    .setVersion('1.0')
    .addServer(process.env.API_URL!, 'localhost')
    .addTag('novabase')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory, {
    jsonDocumentUrl: 'swagger/json',
  });

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
