import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'

const configuredPath = process.env['WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH']?.trim()
const configFile = path.join(os.homedir(), '.weapp-ide-cli/config.json')

async function readConfiguredCliPath() {
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8')) as { cliPath?: unknown }
    return typeof config.cliPath === 'string' ? config.cliPath.trim() : undefined
  }
  catch {
    return undefined
  }
}

const cliPath = configuredPath || await readConfiguredCliPath()
if (!cliPath) {
  throw new Error(`微信 DevTools CLI 未配置。设置 WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH，或配置 ${configFile}。`)
}

await access(cliPath)
const configuredPathFromFile = await readConfiguredCliPath()
if (configuredPath && configuredPathFromFile && path.resolve(configuredPathFromFile) !== path.resolve(configuredPath)) {
  throw new Error(`微信 DevTools CLI 路径不一致：环境变量为 ${configuredPath}，配置文件为 ${configuredPathFromFile}。请先修正配置，脚本不会自动改写登录态。`)
}

const login = await execa(cliPath, ['islogin'], { reject: false })
if (login.exitCode !== 0) {
  throw new Error(`微信 DevTools 未登录（${cliPath}，退出码 ${login.exitCode}）。请在现有 DevTools 窗口完成登录后重试。`)
}

console.log(JSON.stringify({ cliPath, login: true }))
