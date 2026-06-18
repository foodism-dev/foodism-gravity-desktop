const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

module.exports = async function afterPackMacAdhoc(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.FOODISM_MAC_ADHOC_SIGN !== 'true') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!existsSync(appPath)) {
    throw new Error(`未找到 macOS app bundle: ${appPath}`)
  }

  const entitlementsPath = path.join(
    context.packager.projectDir,
    'resources',
    'entitlements.mac.plist'
  )
  const signArgs = ['--force', '--deep', '--sign', '-', '--options', 'runtime']
  if (existsSync(entitlementsPath)) {
    signArgs.push('--entitlements', entitlementsPath)
  }
  signArgs.push(appPath)

  console.log(`[afterPack] 使用 ad-hoc identity 重新签名 macOS 测试包: ${appPath}`)
  execFileSync('codesign', signArgs, { stdio: 'inherit' })
  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' }
  )
}
