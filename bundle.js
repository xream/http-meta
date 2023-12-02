// #!/usr/bin/env node

// const { build } = require('estrella')
// build({
//   entry: 'index.js',
//   outfile: 'dist/http-meta.bundle.js',
//   bundle: true,
//   platform: 'node',
// })

const { filelocPlugin } = require('esbuild-plugin-fileloc')
const { build } = require('esbuild')

build({
  entryPoints: ['index.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  outfile: `dist/http-meta.bundle.js`,
  plugins: [filelocPlugin()],
})
