import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/runtime.ts', './src/client.ts', './src/protocol.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  deps: { dts: { neverBundle: ['./devframe.cjs'] } },
  copy: ['src/devframe.d.cts', 'src/devframe-rpc.d.mts'],
  clean: true,
  target: 'es2022',
  failOnWarn: false,
})
