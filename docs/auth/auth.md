# Auth

开发者使用 novabase dashboard 注册/登录 novabase client

开发者使用 novabase sdk 对目标 project 添加认证功能

## Features

- novabase dashboard 可以使用 email/password 或第三方 OAuth
- 使用 OAuth 注册的用户只能使用该方式进行登录(谷歌)
- 使用双 Token 机制，实现用户无感刷新
- access_token 用于校验，refresh_token 用于 access_token 失效时重新签发
- access_token 有效期 15m，refresh_token 有效期 7d
- novabase sdk 可以使用 email/password 、魔法链接或第三方 OAuth

## Api

### register

```http
POST api/auth/register HTTP/1.1

body:RegisterDto
```

### login

```http
POST api/auth/login HTTP/1.1

body:LoginDto
```

### logout

```http
POST api/auth/logout HTTP/1.1
```

退出登录功能只需要 clear Response 中的双 Token 即可
这样前端 proxy 检测不到 token 则重定向到登录页面

### refresh

```http
POST api/auth/refresh HTTP/1.1
```

### OAuth

## Backend

## Frontend

login/register 页面收集数据，调用 server action 函数

后端校验 login/register 成功后先打到 Next 服务端

在 Next 对 cookie 处理后转交给 browser，`redirect 到 dashboard page`

### proxy

> proxy 不碰业务，但是作为基本门禁校验

已经 **登录/注册** 的用户不应看到登录页

是 **登录/注册** 存在 refresh_token 则尝试刷新

**受保护页面** 且 access_token 失效，但 refresh_token 存在则尝试刷新

其余放行
