import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import pkg from './package.json' with { type: 'json' }

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalIndex = line.indexOf('=')
    if (equalIndex <= 0) continue
    const key = line.slice(0, equalIndex).trim()
    let value = line.slice(equalIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return env
}

function findNearestDotEnv(startDir: string): string | null {
  let current = resolve(startDir)
  while (true) {
    const envPath = resolve(current, '.env')
    if (existsSync(envPath)) return envPath
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function getEnvValue(env: Record<string, string>, key: string): string | undefined {
  return process.env[key] ?? env[key]
}

function resolveFoodismDevFeatures(): boolean {
  const envPath = findNearestDotEnv(__dirname)
  const dotEnv = envPath ? parseDotEnv(readFileSync(envPath, 'utf-8')) : {}
  const explicitDev = getEnvValue(dotEnv, 'FOODISM_DEV')
  if (explicitDev !== undefined) {
    return isTruthyEnv(explicitDev)
  }
  return isTruthyEnv(getEnvValue(dotEnv, 'FOODISM_GRAVITY_DEV'))
    || isTruthyEnv(getEnvValue(dotEnv, 'PROMA_DEV'))
    || isTruthyEnv(getEnvValue(dotEnv, 'DEV'))
}

const foodismDevFeatures = resolveFoodismDevFeatures()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __FOODISM_DEV_FEATURES__: JSON.stringify(foodismDevFeatures),
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@/types': resolve(__dirname, 'src/types'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // 确保使用指定端口，如被占用则报错
    open: false,
  },
})
