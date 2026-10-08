import { IsNumber, IsString } from 'class-validator';

export class SaveObjectDto {
  @IsString()
  name: string;

  @IsNumber()
  size: number;

  @IsString()
  type: string;

  @IsString()
  utKey: string;

  @IsString()
  url: string;
}
