const { build } = require('esbuild')

Promise.all([
  bundle('index.js', 'dist/http-meta.bundle.js'),
  bundle('embedded.js', 'dist/http-meta.embedded.bundle.js'),
]).catch(error => {
  console.error(error)
  process.exitCode = 1
})

function bundle(entryPoint, outfile) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    sourcemap: true,
    platform: 'node',
    format: 'cjs',
    outfile,
  })
}
