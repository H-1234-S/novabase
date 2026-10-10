# TODO

1. 实现类 vs code 打开新标签逻辑
2. 新增创建组织逻辑
3. 新增修改已有表逻辑
4. 优化组织选择界面/项目选择界面侧边栏设计缺陷
5. Storage 功能文件点击后进行预览
6. 实现 uploadthing 上传进度条

# BUG

1. Sidebar 响应式在断点 800-950 区间 Trigger 问题
2. Database 删除 All Table 则 Sidebar 依旧保持 Selected 状态
3. Neon 对空闲数据库约 5 分钟无活动就 suspend 计算，挂起时代理服务器会直接切断 WebSocket
4. Project Auth Providers Save 之后才能保存
