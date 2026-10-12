import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const vite = spawn(
  npmCommand,
  ['exec', 'vite', '--', ...process.argv.slice(2)],
  {
    cwd: frontendDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

vite.on('error', (error) => {
  console.error('Unable to start Vite:', error.message)
  process.exitCode = 1
})
vite.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
