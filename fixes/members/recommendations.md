# 组织成员与邀请修改建议

## MEMBER-001：限定成员更新的组织归属

- **推荐实现**：解析并确认 URL 组织，再以 `org_members.id = memberId AND org_members.org_id = organization.id` 为更新条件。读取目标并更改应放在同一事务；未命中时返回一致的 404。
- **涉及文件**：`apps/api/src/members/members.service.ts`
- **验证**：跨组织 IDOR 回归测试覆盖 role、remove 和 last-admin 检查。

## MEMBER-002：原子保护最后管理员

- **推荐实现**：事务内锁定组织记录（或使用等价的组织级串行化锁），在锁内统计管理员、执行变更；所有管理员变更路径遵循同一锁顺序。
- **涉及文件**：`apps/api/src/members/members.service.ts`
- **验证**：并发更新测试，最终活跃管理员数不得为零。

## MEMBER-003：让邮件副作用具备明确状态

- **推荐实现**：短期先让 `sendMail` 异常向 controller 传播并记录可关联日志；后续以邀请记录 + outbox/重试处理投递。不要在 `catch` 中无声成功。
- **涉及文件**：`apps/api/src/members/invite.service.ts`
- **验证**：SMTP 成功、失败、超时三类测试；失败必须可观察且不返回“已发送”。

## MEMBER-004：补齐新受邀用户的账户激活

- **推荐实现**：邀请链接进入安全的注册/设置密码步骤；完成时事务性校验并消费邀请、设置密码/激活账户、加入组织并签发会话。或者必须先注册再接受邀请。避免匿名接受 GET 创建不可登录的最终用户。
- **涉及文件**：`apps/api/src/members/invite.service.ts`、`apps/api/src/auth/auth.controller.ts`、`apps/api/src/auth/auth.service.ts`，以及前端邀请落地页。
- **验证**：未注册用户可完成注册并访问组织；中途失败不留下无法登录的活跃成员；过期/已消费邀请不能再次使用。
