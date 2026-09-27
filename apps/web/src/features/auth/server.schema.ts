import { z } from 'zod';
import { AUTH_INTENT } from './constants';
import { loginSchema, registerSchema } from './client.schema';

// 可区分联合类型
export const authServerSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal(AUTH_INTENT.LOGIN), ...loginSchema.shape }),
  z.object({ intent: z.literal(AUTH_INTENT.REGISTER), ...registerSchema.shape }),
]);

// z.discriminatedUnion('标签字段名', [分支1, 分支2, ...])