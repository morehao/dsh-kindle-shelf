import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/internal.ts'],
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  outDir: 'lib',
  sourcemap: false,
  // 宿主侧的 @deepseek-ai/* 与共享工具包只在运行时由宿主/依赖提供。
  external: [/^@deepseek-ai\//, /^@morehao\//, /^ssh2/],
})
