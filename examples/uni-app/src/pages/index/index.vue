<script setup lang="ts">
import { ref } from 'vue'
import { createStringStorage, runSqliteDemo } from '@weapp-sqlite/demo-shared'

const status = ref('ready')
const result = ref('点击按钮运行 SQLite migration + transaction')

function createUniStorage() {
  return createStringStorage({
    load: (name) => new Promise((resolve) => {
      uni.getStorage({ key: name, success: ({ data }) => resolve(data as string), fail: () => resolve(undefined) })
    }),
    save: (name, value) => new Promise((resolve, reject) => {
      uni.setStorage({ key: name, data: value, success: resolve, fail: reject })
    }),
  })
}

async function runDemo() {
  status.value = 'running'
  try {
    const demo = await runSqliteDemo({ storage: createUniStorage(), locateFile: file => `/assets/${file}` })
    status.value = 'ready'
    result.value = JSON.stringify(demo.rows)
  }
  catch (error) {
    status.value = 'error'
    result.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <view class="page-shell">
    <view class="eyebrow">uni-app</view>
    <view class="title">SQLite 跨端 demo</view>
    <view class="status">状态：{{ status }}</view>
    <view class="result">{{ result }}</view>
    <button id="run-sqlite" type="primary" @click="runDemo">运行 SQLite</button>
  </view>
</template>

<style scoped>
.page-shell {
  min-height: 100vh;
  padding: 48rpx;
  color: #102a43;
  background: #f4f7f9;
}

.eyebrow,
.title,
.status,
.result {
  display: block;
  margin-bottom: 24rpx;
}

.eyebrow {
  color: #168f7a;
}

.title {
  font-size: 52rpx;
  font-weight: 700;
}

.status,
.result {
  padding: 24rpx;
  background: #fff;
  border-radius: 12rpx;
}
</style>
