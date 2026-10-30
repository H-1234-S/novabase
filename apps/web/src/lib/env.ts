import { z } from 'zod';

/**
 * 浏览器可见的环境变量。
 *
 * 只有 `NEXT_PUBLIC_*` 前缀的变量会被 Next 内联进客户端包，所以这个模块
 * 可以被客户端组件安全导入。服务端专用的变量见 `env.server.ts`。
 *
 * 所有变量在此统一校验：缺失或格式错误时立即抛错，避免出现
 * `undefined/auth/google` 这类静默拼进 URL 的问题。
 */
const clientEnvSchema = z.object({
  apiUrl: z.url(),
  webUrl: z.url(),
});

const parsed = clientEnvSchema.safeParse({
  // 默认值只服务本地开发；生产环境必须在构建时注入真实地址
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api',
  webUrl: process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3001',
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid public environment variables — ${details}`);
}

export const env = parsed.data;
