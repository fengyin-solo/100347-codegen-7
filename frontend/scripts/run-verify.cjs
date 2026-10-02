// 用 esbuild 把验证脚本打成 Node 可执行文件：注入 @ 别名和无 window 的 localStorage 垫片。
const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const store = {}
const storageShim = `
globalThis.__STORE__ = globalThis.__STORE__ || {};
const __mem = globalThis.__STORE__;
globalThis.__browserWindow = {
  localStorage: {
    getItem: (k) => (k in __mem ? __mem[k] : null),
    setItem: (k, v) => { __mem[k] = String(v) },
    removeItem: (k) => { delete __mem[k] },
  },
};
`

esbuild
  .build({
    entryPoints: [path.join(__dirname, 'verify-transfer.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(__dirname, '.verify-transfer.cjs'),
    alias: { '@': path.join(__dirname, '..', 'src') },
    banner: { js: storageShim },
    define: { window: 'globalThis.__browserWindow' },
    logLevel: 'silent',
  })
  .then(() => {
    require(path.join(__dirname, '.verify-transfer.cjs'))
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    fs.rmSync(path.join(__dirname, '.verify-transfer.cjs'), { force: true })
  })
