import axios from 'axios';

// 只在服务端使用（Server Component / Server Action），走内网直连。
// 浏览器侧请改用 @/lib/client-api 的 getClientApiBase()。
const apiClient = axios.create({
  baseURL: process.env.API_URL ?? 'http://localhost:3000/api',
  withCredentials: true,
});

export default apiClient;
