export const COOKIE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;

export const ORG_ROLES = {
  ADMIN: 'admin',
  DEVELOPER: 'developer',
} as const;

export const INVITE_EXPIRES_IN = '24h';

export const PROJECT_KEY_ROLES = {
  ANON: 'anon',
  SERVICE_ROLE: 'service_role',
} as const;

export const COLUMN_TYPES = [
  'text',
  'integer',
  'bigint',
  'boolean',
  'timestamp',
  'uuid',
  'jsonb',
  'numeric',
] as const;

export const TABLE_EDITOR_INTENT = {
  CREATE_TABLE: 'CREATE_TABLE',
  DELETE_TABLE: 'DELETE_TABLE',
  FETCH_TABLE: 'FETCH_TABLE',
  ADD_COLUMN: 'ADD_COLUMN',
} as const;

export type TableEditorIntent =
  (typeof TABLE_EDITOR_INTENT)[keyof typeof TABLE_EDITOR_INTENT];

// Auto Generated REST Api

export const RESERVED_QUERY_PARAMS = new Set([
  'select',
  'order',
  'limit',
  'offset',
]);

// 操作符白名单
export const FILTER_OPERATORS = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
  is: 'IS',
} as const;

export type FilterOperator = keyof typeof FILTER_OPERATORS;

// Realtime
export const REALTIME_EVENTS = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  EVENT: 'event',
  ERROR: 'error',
} as const;
