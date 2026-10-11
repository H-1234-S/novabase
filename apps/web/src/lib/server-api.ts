/**
 * 服务端访问后端的基址。
 *
 * 只在 Server Component / Server Action / Route Handler 里使用，走的是内网直连，
 * 绝不能返回 `/api/proxy` 这种浏览器相对路径。
 */
export function getServerApiBase(): string {
  return (process.env.API_URL ?? 'http://localhost:3000/api').replace(
    /\/$/,
    '',
  );
}

/** 项目维度的 API 基址，例如 https://api.example.com/api/projects/my-slug */
export function getProjectApiBase(projectSlug: string): string {
  return `${getServerApiBase()}/projects/${projectSlug}`;
}
