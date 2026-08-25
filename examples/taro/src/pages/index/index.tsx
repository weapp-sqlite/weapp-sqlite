import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createStringStorage, runSqliteDemo } from '@weapp-sqlite/demo-shared'
import { useState } from 'react'
import './index.scss'

function createTaroStorage() {
  return createStringStorage({
    load: async (name) => {
      try {
        const result = await Taro.getStorage({ key: name })
        return result.data
      }
      catch {
        return undefined
      }
    },
    save: async (name, value) => {
      await Taro.setStorage({ key: name, data: value })
    },
  })
}

export default function Index() {
  const [status, setStatus] = useState('ready')
  const [result, setResult] = useState('点击按钮运行 SQLite migration + transaction')

  async function runDemo() {
    setStatus('running')
    try {
      const demo = await runSqliteDemo({ storage: createTaroStorage(), locateFile: file => `/assets/${file}` })
      setStatus('ready')
      setResult(JSON.stringify(demo.rows))
    }
    catch (error) {
      setStatus('error')
      setResult(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <View className="page-shell">
      <Text className="eyebrow">Taro</Text>
      <Text className="title">SQLite 跨端 demo</Text>
      <Text className="status">
        状态：
        {status}
      </Text>
      <Text className="result">{result}</Text>
      <Button id="run-sqlite" onClick={runDemo}>运行 SQLite</Button>
    </View>
  )
}
