import { IsEmail } from 'class-validator';
import type { MagicLinkInput } from '@novabase/types';

export class MagicLinkDto implements MagicLinkInput {
  @IsEmail()
  email: string;
}
