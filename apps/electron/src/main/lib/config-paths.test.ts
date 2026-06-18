import { describe, expect, test } from 'bun:test'
import { determineConfigDirName, parseEnvFile, resolveConfigDir } from './config-paths'

describe('配置目录名称', () => {
  test('Given 默认正式模式 When 解析配置目录 Then 使用 Foodism Gravity 正式目录', () => {
    expect(determineConfigDirName({ isPackaged: true, env: {} })).toBe('.foodism-gravity')
  })

  test('Given 开发模式 When 解析配置目录 Then 使用 Foodism Gravity 开发目录', () => {
    expect(determineConfigDirName({ isPackaged: false, env: {} })).toBe('.foodism-gravity-dev')
  })

  test('Given .env 开启开发模式 When 解析配置目录 Then 使用开发目录', () => {
    expect(determineConfigDirName({
      isPackaged: true,
      env: { FOODISM_GRAVITY_DEV: '1' },
    })).toBe('.foodism-gravity-dev')
  })

  test('Given .env 用 true 开启开发模式 When 解析配置目录 Then 使用开发目录', () => {
    expect(determineConfigDirName({
      isPackaged: true,
      env: { FOODISM_GRAVITY_DEV: 'true' },
    })).toBe('.foodism-gravity-dev')
  })

  test('Given .env 指定完整配置目录 When 解析配置目录 Then 优先使用完整路径', () => {
    expect(resolveConfigDir({
      homeDir: '/Users/tester',
      isPackaged: true,
      env: { FOODISM_GRAVITY_CONFIG_DIR: '/tmp/foodism-config' },
    })).toBe('/tmp/foodism-config')
  })
})

describe('.env 文件解析', () => {
  test('Given 注释和带引号的值 When 解析 .env Then 返回键值映射', () => {
    expect(parseEnvFile([
      '# 本地开发配置',
      'FOODISM_GRAVITY_DEV=1',
      'FOODISM_GRAVITY_CONFIG_DIR="/tmp/foodism config"',
      '',
    ].join('\n'))).toEqual({
      FOODISM_GRAVITY_DEV: '1',
      FOODISM_GRAVITY_CONFIG_DIR: '/tmp/foodism config',
    })
  })
})
