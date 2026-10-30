import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  platform: 'browser',
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  deps: {
    // 只内联内部私有包（不可发布）。socket.io-client / uploadthing 声明为
    // peerDependencies 并保持外部化，避免宿主应用出现同一库的多份实例。
    alwaysBundle: ['@novabase/constants'],
  },
});
