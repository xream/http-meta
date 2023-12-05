const { build } = require('esbuild')

build({
  entryPoints: ['index.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  outfile: `dist/http-meta.bundle.js`,
})
