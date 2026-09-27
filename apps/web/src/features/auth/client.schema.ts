import { z } from 'zod';
import type { LoginInput, RegisterInput } from '@novabase/types';

export const loginSchema = z.object({
  email: z.email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
}) satisfies z.ZodType<LoginInput>;

// satisfies 真实校验一个值符合某个类型
// as 是类型断言

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
}) satisfies z.ZodType<RegisterInput>;
