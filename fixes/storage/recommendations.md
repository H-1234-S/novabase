# 对象存储修改建议

## STORAGE-001：每次对象操作验证租户归属

- **推荐实现**：以组织/项目 → bucket → object 的 join 构成 scoped 查询；删除先在租户范围加载 utKey 再删远端资源。签名 URL 检查 bucket access 和 key role，private bucket 仅授权身份可取。
- **涉及文件**：`apps/api/src/storage/storage.controller.ts`、`apps/api/src/storage/project-storage.controller.ts`、`apps/api/src/storage/storage.service.ts`
- **验证**：跨租户 IDOR 与 private signed URL 集成测试。

## STORAGE-002：让跨系统删除可重试

- **推荐实现**：增加 pending/deleting/failed 状态或 outbox job；逐对象幂等删除远端资源，成功后删元数据。bucket 删除按对象处理并暴露失败状态。
- **涉及文件**：`apps/api/src/storage/storage.service.ts`、对象 schema/迁移及后台任务。
- **验证**：远端部分失败与 DB 故障后重复执行，最终状态可收敛。
