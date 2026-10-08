import type { BucketAccess } from '@novabase/types';
import { IsEnum, IsString } from 'class-validator';

export class CreateBucketDto {
  @IsString()
  name: string;

  @IsEnum(['public', 'private'])
  access: BucketAccess;
}
