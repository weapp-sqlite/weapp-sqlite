# weapp-sqlite

weapp-sqlite 的统一门面包，复用 `@weapp-sqlite/weapp-vite` 的构建插件与运行时。

```bash
npm install weapp-sqlite
```

```ts
import { weappSqlite } from 'weapp-sqlite'
import { openSqlite } from 'weapp-sqlite/runtime'
```

需要更细粒度控制时，可以直接安装 `@weapp-sqlite/*` 底层包。
