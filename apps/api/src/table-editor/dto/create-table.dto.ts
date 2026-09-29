import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COLUMN_TYPES } from '@novabase/constants';
import type {
  CreateTableInput,
  CreateColumnInput,
  ColumnType,
} from '@novabase/types';

export class CreateColumnDto implements CreateColumnInput {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(COLUMN_TYPES)
  type: ColumnType;

  @IsBoolean()
  isNullable: boolean;

  @IsBoolean()
  isPrimaryKey: boolean;

  @IsString()
  @IsOptional()
  defaultValue?: string;

  @IsString()
  @IsOptional()
  foreignKeyTable?: string;

  @IsString()
  @IsOptional()
  foreignKeyColumn?: string;
}

export class CreateTableDto implements CreateTableInput {
  @IsString()
  @MinLength(1)
  name: string;

  // 处理嵌套对象数组校验
  @IsArray()
  // 对每个元素递归执行该类的校验规则
  @ValidateNested({ each: true })
  // 把纯对象转换成类的实例
  @Type(() => CreateColumnDto)
  columns: CreateColumnDto[];
}
/** 
 *  对每一个对象执行校验
"columns": [
    { "name": "id", "type": "uuid", "isNullable": false, "isPrimaryKey": true },
    { "name": "email", "type": "text", "isNullable": false, "isPrimaryKey": false }
  ]
 */
