import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_GRAVITY_API_BASE_URL = 'https://testpcapi.foodism.pro'

async function readReleaseWorkflow(): Promise<string> {
  const workflowPath = join(dirname(fileURLToPath(import.meta.url)), '../../../../../.github/workflows/release.yml')
  return Bun.file(workflowPath).text()
}

describe('Release workflow 配置', () => {
  test('Given 发布打包流程 When 构建 Electron 应用 Then 默认注入 Gravity API 地址', async () => {
    const workflow = await readReleaseWorkflow()

    expect(workflow).toContain(`default: '${DEFAULT_GRAVITY_API_BASE_URL}'`)
    expect(workflow).toContain('VITE_API_BASE_URL: ${{ github.event.inputs.api_base_url')
    expect(workflow).toContain(`printf '\\nVITE_API_BASE_URL=%s\\n' "$VITE_API_BASE_URL" >> apps/electron/resources/default.env`)
  })
})
