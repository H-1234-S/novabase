import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  // @novabase/types 与 @novabase/constants 直接以 TypeScript 源码形式被消费，
  // 必须显式交给 Next 转译，否则依赖符号链接的解析结果会随构建器版本变化。
  transpilePackages: ['@novabase/types', '@novabase/constants'],
};

export default nextConfig;
