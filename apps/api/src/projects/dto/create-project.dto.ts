import { IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateProjectInput } from '@novabase/types';

export class CreateProjectDto implements CreateProjectInput {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  name: string;
}
