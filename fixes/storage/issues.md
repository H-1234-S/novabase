# 对象存储问题

## [STORAGE-001] 控制台与 SDK 文件操作存在跨项目对象 IDOR

- **优先级**：P1
- **问题类型**：授权绕过 / 多租户隔离 / 私有数据泄露
- **涉及文件**：`apps/api/src/storage/storage.controller.ts`、`apps/api/src/storage/project-storage.controller.ts`、`apps/api/src/storage/storage.service.ts`
- **涉及位置**：控制台 `deleteBucket/getObjects/deleteObject/getSignedUrl`；SDK `deleteObject/getSignedUrl`；service 按 bucketId/objectId 单独查询
- **问题描述**：控制台仅验证调用者属于 URL 组织，没有将 bucket/object 限定为该组织项目资源。SDK 虽核对 projectSlug 与 key projectId，但删除/签名只按 objectId 查询，不验证对象 bucket 属于该 projectId。签名 URL 也不检查 bucket access。
- **触发条件**：授权用户/anon key 使用获知的其他项目 UUID；或 anon key 请求 private bucket object 的签名 URL。
- **根因分析**：认证与对象查询分开，最终操作只按主键，没有 tenant join；signed-url 路径没有 role/access 校验。
- **影响范围**：跨组织删除 bucket/文件、读取对象元数据及取得 private 文件下载地址。
- **修复建议**：每个操作在 SQL 中联合验证组织/项目/bucket/object 归属；控制台 service 接受 orgSlug/projectSlug，SDK service 接受 projectId 并 join。明确定义 private bucket 授权，anon key 不得无条件签名。
- **验证方式**：跨组织 UUID、跨项目 SDK object ID 和 private bucket anon 签名均拒绝；同租户操作正常。
- **置信度**：已确认

## [STORAGE-002] 云端删除与数据库删除顺序可能造成孤儿状态

- **优先级**：P2
- **问题类型**：跨系统一致性 / 异常恢复
- **涉及文件**：`apps/api/src/storage/storage.service.ts`
- **涉及位置**：`deleteBucket()`、`deleteObject()` 先调用 `utapi.deleteFiles()` 后删数据库记录
- **问题描述**：UploadThing 与 PostgreSQL 不能共享事务。远端删除成功而 DB 删除失败，会让元数据指向不存在文件；多文件删除部分成功也没有逐项状态。
- **触发条件**：第三方部分失败、远端成功后数据库故障、bucket 多文件删除中断。
- **根因分析**：跨服务副作用串行执行，没有删除状态、幂等任务或补偿流程。
- **影响范围**：列表出现失效文件、云端孤儿文件或无法判断重试是否完成。
- **修复建议**：采用删除状态/outbox 或逐对象幂等工作流，支持重试并记录远端结果；短期检查删除结果并保留可重试记录。
- **验证方式**：注入远端部分成功及远端成功后 DB 失败，重复执行应可收敛且不误删其他对象。
- **置信度**：已确认
