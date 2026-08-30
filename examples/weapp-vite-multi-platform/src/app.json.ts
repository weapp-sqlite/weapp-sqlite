import { subPackages } from 'weapp-vite/auto-routes'
import { defineAppJson } from 'weapp-vite/json'

export default defineAppJson({
  pages: ['pages/index/index'],
  subPackages,
  window: {
    navigationBarTitleText: 'weapp-sqlite',
    navigationBarBackgroundColor: '#102a43',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f4f7f9',
  },
})
