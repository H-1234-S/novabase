# Realtime

前端用户打开某一表的实时功能；后端推送对于该表的 INSERT/DELETE/PATH 操作信息

利用 socket.io-client 与 socket.io 进行实时功能

使用 Neon Postgres 第三方服务

## Features

- 进入该页面即 connect，使用 anonKey 进行鉴权
- 触发表监听使用 fetch + cookie + token 进行鉴权
- 用户选择监听某一表；可以选择多表
- 对选定表的 INSERT/DELETE/UPDATE Operation 推送到前端

## Api

### 触发监听

该接口无 body，所有参数位于 SearchParams 中

该接口用于触发监听某一表，用户点击 Switch 时触发

```http
POST api/orgs/:slug/projects/:projectSlug/realtime/:tableName/enable HTTP/1.1
```

### 结束监听

```http
DELETE api/orgs/:slug/projects/:projectSlug/realtime/:tableName/disable HTTP/1.1
```

### 建立 Socket 连接

用于进入 realtime page 时建立连接使用

```ws
api/realtime WS

auth: { token: anonKey }
transports: ['websocket', 'polling']
```

anonKey 用于做多租户隔离，只 join('project:<id>')

## Backend

### 基础结构

realtime.controller.ts 复用 JwtAuthGuard 与 OrgRoleGuard 对 fetch 进行鉴权

trigger.service.ts 用于在目标表上建立触发器

realtime.gateway.ts 用于监听和转发

realtime.service.ts 则为具体的逻辑层

### 核心逻辑

> 其实就是使用的 `Postgresql` 的 `pg_notify` 进行广播；所有 `LISTEN(channel)` 都会收到通知

前端进入 realtime 页面则携带 anonKey 向 api/realtime 发送请求

handleConnection 校验通过后允许建立连接并进入 `project:${payload.projectId}` 房间

之后点击目标表的 switch 后，向 `api/orgs/:slug/projects/:projectSlug/realtime/:tableName/enable` 发送请求

trigger.service.ts 构造通知函数并将函数绑定到目标表上

### 边界处理

浏览器 - Nest Gateway，断开连接时 Socket.io-client 自动重连

客户端保存用户的订阅列表，connect 后重新订阅

```ts
socket.on('connect', () => {
  setConnected(true);
  for (const tableName of subscribedRef.current) {
    socket.emit(REALTIME_EVENTS.SUBSCRIBE, tableName); // 补订阅
  }
});
```

重连不是恢复原 socket，而是新建一条连接

## Frontend
