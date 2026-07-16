// Pre-push safety check: build the frontend and syntax-check every server file.
// Blocks a push (and therefore a Railway deploy) if the app wouldn't build.
// Run manually with `npm run check`, or automatically on `git push`.
import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

function serverJsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...serverJsFiles(p))
    else if (entry.name.endsWith('.js')) out.push(p)
  }
  return out
}

try {
  console.log('▶ Building frontend (vite build)…')
  execSync('npx vite build', { stdio: 'inherit' })

  console.log('▶ Syntax-checking server files…')
  for (const file of serverJsFiles('server')) {
    execSync(`node --check "${file}"`, { stdio: 'inherit' })
  }

  console.log('\n✅ All checks passed — safe to push.')
} catch (_err) {
  console.error('\n❌ Checks failed. Fix the errors above before pushing.')
  process.exit(1)
}
