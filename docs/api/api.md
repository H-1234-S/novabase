# Api

根据用户创建的 Table，自动生成对应的 RESTfull 风格的 Api

> **现在的做法：**

硬编码 REST Api，只提供五个可访问、可使用的 Api 服务

调用时请求打到 project-api.controller Nest 服务端

> **优化：**

可以使用 PostgREST 服务

## Features

- 所有 project-api 走 ProjectKeyGuard 进行校验
- 用户创建表后根据该表字段自动生成 RESTFull Api
- 对于列名、表名无法使用参数化查询，定义校验函数，防止 SQL 注入
- 定义 assertSafeIdentifier 函数防 SQL 处理
- 定义 Whitelist / Blacklist

## Api

```http
GET api/projects/:projectSlug/rest/:table HTTP/1.1
```

通过构建不同的查询参数获取目标表的指定信息

---

```http
POST api/projects/:projectSlug/rest/:table HTTP/1.1

body:表字段
```

将数据插入到目标表中

---

## Backend

创建 ProjectKeyGuard 对该 Controller 所有路由进行校验

> ANON_KEY 即可，对于非幂等操作需要 SERVICE_ROLE_KEY

定义路由

取参数，对参数进行处理防 **SQL 注入** 处理

然后拼 SQL 语句，使用 `drizzle.db.execute` 执行

然后返回数据给前端

---

校验 - 拼 SQL

## Frontend
