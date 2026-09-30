import { BadRequestException } from '@nestjs/common';
import {
  RESERVED_QUERY_PARAMS,
  FILTER_OPERATORS,
  type FilterOperator,
} from '@novabase/constants';

export interface ParsedQuery {
  select: string[];
  filters: FilterClause[];
  orderBy: OrderClause | null;
  limit: number;
  offset: number;
}

interface FilterClause {
  column: string;
  operator: string;
  value: string;
}

interface OrderClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

// 防 SQL 注入校验函数
function assertSafeIdentifier(name: string, label: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new BadRequestException(`Invalid ${label}: ${name}`);
  }
}

// 格式化 SQL 值
function formatSqlValue(operator: string, rawValue: string): string {
  const value = rawValue.replace(/;/g, '');

  // IS 操作符，判断为空还是不为空
  if (operator === 'IS') {
    return value.toUpperCase() === 'NULL' ? 'NULL' : 'NOT NULL';
  }

  if (operator === 'LIKE' || operator === 'ILIKE') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
    return value.toLowerCase();
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "''")}'`;
}

// 解析查询参数
export function parseQueryParams(params: Record<string, string>): ParsedQuery {
  const filters: FilterClause[] = [];
  let select: string[] = [];
  let orderBy: OrderClause | null = null;
  let limit = 100;
  let offset = 0;

  // parse -> { select:'id,name', ... }
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED_QUERY_PARAMS.has(key)) {
      switch (key) {
        // "id,name" → ['id','name'],
        case 'select':
          select = value
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          // 校验，防止 SQL 注入
          select.forEach((col) => assertSafeIdentifier(col, 'select column'));
          break;
        // 排序 "created_at.desc" → { column:'created_at', direction:'DESC' }
        case 'order': {
          const [col, dir] = value.split('.');
          assertSafeIdentifier(col, 'order column');
          orderBy = {
            column: col,
            // DESC 降序
            // ASC 升序
            direction: dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
          };
          break;
        }
        // 限制返回行数
        case 'limit':
          limit = Math.min(parseInt(value, 10) || 100, 1000);
          break;
        // 跳过行数
        case 'offset':
          offset = Math.max(parseInt(value, 10) || 0, 0);
          break;
        // limit 配合 offset 实现分页效果
      }
      continue;
    }

    assertSafeIdentifier(key, 'filter column');

    const dotIndex = value.indexOf('.');
    if (dotIndex === -1) continue;

    // slice 切片
    // splice 替换原数组元素
    const operator = value.slice(0, dotIndex) as FilterOperator;
    const filterValue = value.slice(dotIndex + 1);

    if (!(operator in FILTER_OPERATORS)) continue;

    filters.push({
      column: key,
      operator: FILTER_OPERATORS[operator],
      value: filterValue,
    });
  }

  return { select, filters, orderBy, limit, offset };
}

// 构建 WHERE 查询条件语句
export function buildWhereClause(filters: FilterClause[]): string {
  if (filters.length === 0) return '';

  const clauses = filters.map(({ column, operator, value }) => {
    const sqlValue = formatSqlValue(operator, value);

    if (operator === 'IS') {
      return `"${column}" IS ${sqlValue}`;
    }

    // LIKE 区分大小写的模糊匹配
    // ILIKE 不区分大小写的模糊匹配
    if (operator === 'LIKE' || operator === 'ILIKE') {
      return `"${column}" ${operator} ${sqlValue}`;
    }

    return `"${column}" ${operator} ${sqlValue}`;
  });

  return `WHERE ${clauses.join(' AND ')}`;
}
