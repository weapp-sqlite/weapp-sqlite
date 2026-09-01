import process from 'node:process'
import { subPackages } from 'weapp-vite/auto-routes'
import { defineAppJson } from 'weapp-vite/json'

const sqliteSubpackage = {
  root: '__weapp_sqlite__',
  pages: ['__entry__/index'],
}
const platformArgumentIndex = process.argv.findIndex(argument => argument === '-p' || argument === '--platform')
const platform = platformArgumentIndex < 0 ? undefined : process.argv[platformArgumentIndex + 1]
const includeSqliteSubpackage = platform === undefined || platform === 'weapp'

export default defineAppJson({
  pages: ['pages/index/index'],
  subPackages: !includeSqliteSubpackage || subPackages.some(item => item.root === sqliteSubpackage.root)
    ? subPackages
    : [...subPackages, sqliteSubpackage],
  window: {
    navigationBarTitleText: 'weapp-sqlite',
    navigationBarBackgroundColor: '#102a43',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f4f7f9',
  },
})
