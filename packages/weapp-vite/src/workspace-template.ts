export const GENERATED_PAGE_MARKER = 'weapp-sqlite generated debug page v1'

export function workspacePageScript(configImport: string) {
  return `// ${GENERATED_PAGE_MARKER}\nimport { createSqliteDebugWorkspacePage } from '@weapp-sqlite/weapp-vite/workspace'\nimport workspace from ${JSON.stringify(configImport)}\n\nPage(createSqliteDebugWorkspacePage(workspace))\n`
}

export const workspacePageJson = JSON.stringify({
  navigationBarTitleText: 'SQLite 数据工作台',
  navigationBarBackgroundColor: '#182126',
  navigationBarTextStyle: 'white',
  backgroundColor: '#f3f5f6',
}, null, 2)

export const workspacePageTemplate = `<!-- ${GENERATED_PAGE_MARKER} -->
<view id="sqlite-workspace" class="workspace">
  <view class="workspace-toolbar">
    <view class="workspace-identity">
      <text class="workspace-title">SQLite 数据工作台</text>
      <text id="debug-runtime" class="workspace-meta">{{databaseName}} · {{runtimeLabel}}</text>
    </view>
    <view class="toolbar-actions">
      <button id="debug-refresh" class="icon-command" bind:tap="refreshWorkspace">↻ 刷新</button>
      <button id="debug-undo" class="icon-command" bind:tap="undoLast" disabled="{{undoLabel === '暂无可撤销操作'}}">↶ 撤销</button>
      <button id="debug-export-database" class="primary-command" bind:tap="exportDatabase">⇩ SQLite</button>
      <button id="debug-import-file" class="icon-command" bind:tap="chooseImport">⇧ 导入</button>
    </view>
  </view>

  <view wx:if="{{phase === 'loading'}}" id="debug-loading" class="workspace-state">正在打开数据库…</view>
  <view wx:elif="{{phase !== 'ready'}}" id="debug-error" class="workspace-state error-state">
    <text>{{error.code}}</text>
    <text>{{error.message}}</text>
  </view>

  <view wx:else class="workspace-layout">
    <view class="table-sidebar">
      <view class="sidebar-heading">
        <text>对象</text>
        <text class="count-label">{{tables.length}}</text>
      </view>
      <scroll-view scroll-y class="table-list">
        <button wx:for="{{tables}}" wx:key="name" id="debug-table-{{item.name}}" class="table-button {{selectedTable === item.name ? 'active' : ''}}" data-table="{{item.name}}" bind:tap="selectTable">
          <text class="object-symbol">{{item.type === 'view' ? 'V' : 'T'}}</text>
          <text class="table-name">{{item.name}}</text>
        </button>
      </scroll-view>
      <view class="sidebar-create">
        <input id="debug-new-table" value="{{formName}}" bindinput="onFormName" placeholder="新表名称" />
        <input id="debug-new-table-column" value="{{formValue}}" bindinput="onFormValue" placeholder="数据列名称" />
        <button id="debug-create-table" bind:tap="createTable">＋ 创建表</button>
      </view>
    </view>

    <view class="workspace-main">
      <view class="mobile-table-select">
        <text>当前对象</text>
        <scroll-view scroll-x class="mobile-table-strip">
          <button wx:for="{{tables}}" wx:key="name" id="debug-mobile-table-{{item.name}}" class="table-chip {{selectedTable === item.name ? 'active' : ''}}" data-table="{{item.name}}" bind:tap="selectTable">{{item.name}}</button>
        </scroll-view>
      </view>

      <view class="workspace-tabs">
        <button id="debug-tab-data" class="tab-button {{activeTab === 'data' ? 'active' : ''}}" data-tab="data" bind:tap="switchTab">数据</button>
        <button id="debug-tab-schema" class="tab-button {{activeTab === 'schema' ? 'active' : ''}}" data-tab="schema" bind:tap="switchTab">结构</button>
        <button id="debug-tab-sql" class="tab-button {{activeTab === 'sql' ? 'active' : ''}}" data-tab="sql" bind:tap="switchTab">SQL</button>
        <button id="debug-tab-activity" class="tab-button {{activeTab === 'activity' ? 'active' : ''}}" data-tab="activity" bind:tap="switchTab">操作记录</button>
      </view>

      <view wx:if="{{activeTab === 'data'}}" id="debug-data-view" class="tab-content data-view">
        <view class="data-tools">
          <view class="search-control">
            <input id="debug-search" value="{{search}}" bindinput="onSearchInput" confirm-type="search" bindconfirm="applySearch" placeholder="搜索当前表" />
            <button bind:tap="applySearch">搜索</button>
          </view>
          <view class="data-actions">
            <button id="debug-insert-row" bind:tap="openInsert" disabled="{{!capabilities.writable}}">＋ 新增行</button>
            <button id="debug-delete-rows" class="danger-command" bind:tap="requestDeleteRows" disabled="{{selectedRows.length === 0}}">删除所选</button>
            <button data-format="csv" bind:tap="exportTable">⇩ CSV</button>
            <button data-format="json" bind:tap="exportTable">⇩ JSON</button>
          </view>
        </view>

        <view class="filter-bar">
          <picker id="debug-filter-column" range="{{columns}}" range-key="name" bindchange="onFilterColumn"><view class="picker-control">{{filterColumn || '选择列'}}</view></picker>
          <picker id="debug-filter-operator" range="{{filterOperators}}" range-key="label" bindchange="onFilterOperator"><view class="picker-control">{{filterOperator}}</view></picker>
          <input value="{{filterValue}}" bindinput="onFilterValue" placeholder="筛选值" />
          <button id="debug-add-filter" bind:tap="addFilter">添加筛选</button>
          <button bind:tap="clearFilters" disabled="{{filters.length === 0}}">清除</button>
          <text class="filter-count">{{filters.length}} 条筛选</text>
        </view>

        <scroll-view scroll-x class="data-grid-scroll">
          <view id="debug-data-grid" class="data-grid">
            <view class="grid-row grid-header">
              <view class="selection-cell"></view>
              <button wx:for="{{columns}}" wx:key="name" class="grid-cell header-cell" data-column="{{item.name}}" bind:tap="sortColumn">
                <text>{{item.name}}</text>
                <text class="column-type">{{item.type || 'ANY'}}</text>
              </button>
              <view class="row-action-cell">操作</view>
            </view>
            <view wx:for="{{displayRows}}" wx:key="index" wx:for-item="row" class="grid-row {{row.selected ? 'selected' : ''}}">
              <button id="debug-select-row-{{row.index}}" class="selection-cell row-selector" data-index="{{row.index}}" bind:tap="toggleRow">{{row.selected ? '✓' : ''}}</button>
              <view wx:for="{{row.cells}}" wx:key="column" wx:for-item="cell" class="grid-cell value-cell value-{{cell.kind}}">
                <text class="type-mark">{{cell.kind}}</text>
                <text selectable="true">{{cell.value}}</text>
              </view>
              <button id="debug-edit-row-{{row.index}}" class="row-action-cell" data-index="{{row.index}}" bind:tap="openEdit" disabled="{{!capabilities.writable}}">编辑</button>
            </view>
            <view wx:if="{{displayRows.length === 0}}" class="empty-grid">当前范围没有数据</view>
          </view>
        </scroll-view>
        <view class="pagination">
          <text>{{page.offset + 1}}–{{page.offset + displayRows.length}} / {{page.total}}</text>
          <view class="pagination-actions">
            <button id="debug-page-previous" bind:tap="previousPage" disabled="{{page.offset <= 0}}">‹</button>
            <button id="debug-page-next" bind:tap="nextPage" disabled="{{page.offset + page.limit >= page.total}}">›</button>
          </view>
        </view>

        <view wx:if="{{importPreview}}" id="debug-import-preview" class="import-panel">
          <view class="section-heading"><text>导入预览</text><text>{{importPreview.totalRows}} 行</text></view>
          <view wx:for="{{importMappings}}" wx:key="source" class="mapping-row">
            <text>{{item.source}}</text><text>→</text><input data-index="{{index}}" value="{{item.target}}" bindinput="updateImportTarget" /><text>{{item.type}}</text>
          </view>
          <view class="import-actions">
            <view class="mode-control">
              <button wx:for="{{importModes}}" wx:key="value" id="debug-import-mode-{{item.value}}" class="{{importMode === item.value ? 'active' : ''}}" data-mode="{{item.value}}" bind:tap="onImportMode">{{item.label}}</button>
            </view>
            <input wx:if="{{importMode === 'replace'}}" id="debug-import-confirm" value="{{importConfirmValue}}" bindinput="onImportConfirmInput" placeholder="输入表名确认替换" />
            <button id="debug-run-import" class="primary-command" bind:tap="runImport">执行导入</button>
          </view>
        </view>
      </view>

      <view wx:elif="{{activeTab === 'schema'}}" id="debug-schema-view" class="tab-content schema-view">
        <view class="schema-toolbar">
          <text class="object-title">{{selectedTable}}</text>
          <text class="capability-label">{{capabilities.writable ? capabilities.locator : capabilities.reason}}</text>
          <button id="debug-truncate-table" class="danger-command" bind:tap="requestTruncate">清空表</button>
          <button id="debug-drop-table" class="danger-command" bind:tap="requestDropTable">删除表</button>
        </view>
        <view class="schema-section">
          <view class="section-heading"><text>列</text><text>{{columns.length}}</text></view>
          <view wx:for="{{columns}}" wx:key="name" class="schema-row">
            <text class="schema-name">{{item.name}}</text><text>{{item.type || 'ANY'}}</text><text>{{item.primaryKey ? 'PK' : ''}}</text><text>{{item.notNull ? 'NOT NULL' : 'NULL'}}</text>
            <button id="debug-drop-column-{{item.name}}" class="inline-danger" data-column="{{item.name}}" bind:tap="requestDropColumn">删除</button>
          </view>
          <view class="schema-form">
            <input value="{{formName}}" bindinput="onFormName" placeholder="列名" />
            <picker id="debug-column-type" range="{{columnTypes}}" bindchange="onFormType"><view class="picker-control">{{formType}}</view></picker>
            <button id="debug-add-column" bind:tap="addColumn">新增列</button>
          </view>
          <view class="schema-form">
            <input value="{{formName}}" bindinput="onFormName" placeholder="原列名" />
            <input value="{{formValue}}" bindinput="onFormValue" placeholder="新列名" />
            <button id="debug-rename-column" bind:tap="renameColumn">重命名列</button>
          </view>
        </view>
        <view class="schema-section">
          <view class="section-heading"><text>索引</text><text>{{indexes.length}}</text></view>
          <view wx:for="{{indexes}}" wx:key="name" class="schema-row">
            <text class="schema-name">{{item.name}}</text><text>{{item.unique ? 'UNIQUE' : 'INDEX'}}</text><text>{{item.columns.length}} 列</text>
            <button id="debug-drop-index-{{item.name}}" class="inline-danger" data-index-name="{{item.name}}" bind:tap="requestDropIndex" disabled="{{!item.editable}}">删除</button>
          </view>
          <view class="schema-form">
            <input value="{{formName}}" bindinput="onFormName" placeholder="索引名" />
            <input value="{{formValue}}" bindinput="onFormValue" placeholder="列名:asc，以逗号分隔" />
            <button id="debug-index-unique" class="{{indexUnique ? 'active' : ''}}" bind:tap="toggleIndexUnique">{{indexUnique ? '唯一索引' : '普通索引'}}</button>
            <button id="debug-create-index" bind:tap="createIndex">创建索引</button>
          </view>
        </view>
        <view class="schema-section schema-form">
          <input value="{{formName}}" bindinput="onFormName" placeholder="新的表名" />
          <button id="debug-rename-table" bind:tap="renameTable">重命名当前表</button>
        </view>
      </view>

      <view wx:elif="{{activeTab === 'sql'}}" id="debug-sql-view" class="tab-content sql-view">
        <textarea id="debug-sql-editor" value="{{sql}}" bindinput="onSqlInput" maxlength="20000" />
        <view class="sql-actions">
          <button id="debug-run-query" class="primary-command" bind:tap="runQuery">运行查询</button>
          <button id="debug-run-write" class="danger-command" bind:tap="requestWriteSql">执行写入</button>
        </view>
        <text id="debug-result" class="result-output" selectable="true">{{result}}</text>
      </view>

      <view wx:else id="debug-activity-view" class="tab-content activity-view">
        <view wx:for="{{activities}}" wx:key="id" class="activity-row activity-{{item.status}}">
          <text>{{item.time}}</text><text>{{item.action}}</text><text>{{item.detail}}</text>
        </view>
        <view wx:if="{{activities.length === 0}}" class="empty-grid">本次会话还没有操作</view>
      </view>

      <view wx:if="{{error}}" class="inline-error"><text>{{error.code}}</text><text>{{error.message}}</text></view>
    </view>
  </view>

  <view wx:if="{{editorOpen}}" class="drawer-backdrop" bind:tap="closeEditor"></view>
  <view wx:if="{{editorOpen}}" id="debug-row-editor" class="edit-drawer">
    <view class="drawer-heading"><text>{{editorMode === 'insert' ? '新增行' : '编辑行'}}</text><button id="debug-close-editor" bind:tap="closeEditor">×</button></view>
    <scroll-view scroll-y class="drawer-fields">
      <view wx:for="{{editorFields}}" wx:key="name" class="field-row">
        <view class="field-label"><text>{{item.name}}</text><text>{{item.type || 'ANY'}}</text></view>
        <input data-index="{{index}}" value="{{item.value}}" bindinput="updateEditorField" disabled="{{item.disabled || item.isNull}}" />
        <button data-index="{{index}}" bind:tap="toggleEditorNull" disabled="{{item.disabled}}">{{item.isNull ? 'NULL' : '设为 NULL'}}</button>
      </view>
    </scroll-view>
    <button id="debug-save-row" class="primary-command drawer-save" bind:tap="saveEditor">保存更改</button>
  </view>

  <view wx:if="{{confirmOpen}}" class="modal-backdrop">
    <view id="debug-confirm-dialog" class="confirm-dialog">
      <text class="confirm-title">确认危险操作</text>
      <text wx:if="{{confirmTarget}}">输入 {{confirmTarget}} 后继续。操作前会自动创建撤销快照。</text>
      <text wx:else>确认执行写 SQL。操作前会自动创建撤销快照。</text>
      <input wx:if="{{confirmTarget}}" id="debug-confirm-input" value="{{confirmValue}}" bindinput="onConfirmInput" placeholder="输入完整表名" />
      <view class="confirm-actions"><button bind:tap="closeConfirmation">取消</button><button id="debug-confirm-action" class="danger-command" bind:tap="confirmDanger">确认执行</button></view>
    </view>
  </view>
</view>
`

export const workspacePageStyle = `/* ${GENERATED_PAGE_MARKER} */
page { min-height: 100%; background: #f3f5f6; }
.workspace { min-height: 100vh; color: #182126; background: #f3f5f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.workspace-toolbar { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; min-height: 112rpx; padding: 20rpx 28rpx; color: #f8fafb; background: #182126; border-bottom: 4rpx solid #1d8b7a; }
.workspace-identity { display: flex; flex-direction: column; min-width: 0; }
.workspace-title { font-size: 30rpx; font-weight: 700; }
.workspace-meta { margin-top: 4rpx; overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19rpx; color: #b9c5c9; text-overflow: ellipsis; white-space: nowrap; }
.toolbar-actions, .data-actions, .pagination-actions, .sql-actions, .confirm-actions, .import-actions { display: flex; gap: 12rpx; align-items: center; }
.import-actions { flex-wrap: wrap; }
#debug-import-confirm { flex: 1 1 260rpx; min-width: 200rpx; }
button { box-sizing: border-box; min-height: 56rpx; padding: 0 18rpx; margin: 0; font-size: 22rpx; line-height: 54rpx; letter-spacing: 0; color: #26343a; background: #fff; border: 2rpx solid #cbd4d8; border-radius: 6rpx; }
button::after { display: none; }
button[disabled] { color: #93a0a6; background: #edf0f1; border-color: #dce2e4; }
.primary-command { color: #fff; background: #177e6f; border-color: #177e6f; }
.danger-command, .inline-danger { color: #b42318; border-color: #e5b8b4; }
.workspace-layout { display: grid; grid-template-columns: minmax(220rpx, 300rpx) minmax(0, 1fr); min-height: calc(100vh - 112rpx); }
.table-sidebar { display: flex; flex-direction: column; min-width: 0; background: #e9edef; border-right: 2rpx solid #cbd4d8; }
.sidebar-heading, .section-heading, .drawer-heading { display: flex; align-items: center; justify-content: space-between; font-weight: 700; }
.sidebar-heading { padding: 22rpx 20rpx 12rpx; font-size: 22rpx; color: #526269; }
.count-label, .capability-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19rpx; font-weight: 400; color: #66777e; }
.table-list { flex: 1; max-height: calc(100vh - 340rpx); }
.table-button { display: flex; gap: 12rpx; align-items: center; width: 100%; padding: 0 18rpx; color: #34444b; text-align: left; background: transparent; border: 0; border-radius: 0; }
.table-button.active { color: #0c6559; background: #d4e8e4; border-left: 6rpx solid #177e6f; }
.object-symbol { display: inline-flex; align-items: center; justify-content: center; width: 30rpx; height: 30rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17rpx; color: #fff; background: #64767d; border-radius: 4rpx; }
.table-name { overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-create { display: grid; gap: 10rpx; padding: 16rpx; border-top: 2rpx solid #cbd4d8; }
input, textarea, .picker-control { box-sizing: border-box; width: 100%; padding: 0 16rpx; font-size: 22rpx; color: #182126; background: #fff; border: 2rpx solid #c3cdd1; border-radius: 5rpx; }
input { height: 58rpx; }
.picker-control { min-width: 180rpx; height: 58rpx; line-height: 56rpx; }
.mode-control { display: flex; gap: 6rpx; }
.mode-control button.active, #debug-index-unique.active { color: #fff; background: #177e6f; border-color: #177e6f; }
.workspace-main { min-width: 0; background: #f8f9f9; }
.workspace-tabs { display: flex; min-height: 76rpx; padding: 0 22rpx; background: #fff; border-bottom: 2rpx solid #d7dee1; }
.tab-button { min-width: 112rpx; height: 76rpx; color: #66777e; background: transparent; border: 0; border-bottom: 5rpx solid transparent; border-radius: 0; }
.tab-button.active { color: #0c6559; border-bottom-color: #177e6f; }
.tab-content { min-height: calc(100vh - 190rpx); }
.data-tools, .filter-bar, .schema-toolbar, .schema-form { display: flex; gap: 12rpx; align-items: center; }
.data-tools { justify-content: space-between; padding: 18rpx 22rpx; border-bottom: 2rpx solid #dce2e4; }
.search-control { display: grid; grid-template-columns: minmax(180rpx, 420rpx) auto; gap: 8rpx; }
.filter-bar { padding: 12rpx 22rpx; overflow-x: auto; background: #eef2f3; border-bottom: 2rpx solid #d4dcdf; }
.filter-bar input { flex: 0 0 210rpx; }
.filter-count { flex: 0 0 auto; font-size: 20rpx; color: #66777e; }
.data-grid-scroll { width: 100%; background: #fff; }
.data-grid { min-width: 1100rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.grid-row { display: flex; min-height: 72rpx; border-bottom: 2rpx solid #e1e6e8; }
.grid-row.selected { background: #e5f3f0; }
.grid-header { position: sticky; top: 0; z-index: 2; color: #405159; background: #edf1f2; }
.grid-cell, .selection-cell, .row-action-cell { box-sizing: border-box; display: flex; flex: 0 0 220rpx; min-width: 220rpx; padding: 12rpx 14rpx; overflow: hidden; border-right: 2rpx solid #e1e6e8; }
.selection-cell { flex-basis: 64rpx; min-width: 64rpx; align-items: center; justify-content: center; padding: 0; }
.row-action-cell { flex-basis: 100rpx; min-width: 100rpx; align-items: center; justify-content: center; }
.header-cell { flex-direction: column; align-items: flex-start; justify-content: center; color: #34444b; background: transparent; border-width: 0 2rpx 0 0; border-radius: 0; }
.column-type, .type-mark { font-size: 16rpx; text-transform: uppercase; color: #78888e; }
.value-cell { position: relative; flex-direction: column; justify-content: center; font-size: 20rpx; word-break: break-all; }
.value-null { color: #8c6c16; background: #fffaf0; }
.value-integer, .value-real { color: #245f94; }
.value-blob { color: #72569a; }
.empty-grid, .workspace-state { padding: 64rpx 28rpx; color: #66777e; text-align: center; }
.pagination { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 22rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20rpx; background: #fff; border-top: 2rpx solid #dce2e4; }
.pagination button { width: 64rpx; padding: 0; font-size: 32rpx; }
.schema-toolbar { padding: 20rpx 24rpx; border-bottom: 2rpx solid #d7dee1; }
.object-title { margin-right: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28rpx; font-weight: 700; }
.schema-section { padding: 20rpx 24rpx; border-bottom: 2rpx solid #d7dee1; }
.schema-row { display: grid; grid-template-columns: minmax(180rpx, 2fr) 1fr .5fr 1fr auto; gap: 14rpx; align-items: center; min-height: 68rpx; font-size: 21rpx; border-bottom: 2rpx solid #e4e8ea; }
.schema-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.schema-form { margin-top: 16rpx; }
.schema-form input { max-width: 280rpx; }
.sql-view { padding: 24rpx; }
#debug-sql-editor { min-height: 360rpx; padding: 20rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.55; }
.sql-actions { margin-top: 16rpx; }
.result-output { display: block; min-height: 180rpx; padding: 18rpx; margin-top: 18rpx; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19rpx; white-space: pre-wrap; background: #182126; color: #d8e2e5; border-radius: 5rpx; }
.activity-row { display: grid; grid-template-columns: 140rpx 180rpx 1fr; gap: 18rpx; padding: 16rpx 24rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20rpx; border-bottom: 2rpx solid #e0e5e7; }
.activity-success { border-left: 6rpx solid #177e6f; }
.activity-error, .inline-error, .error-state { color: #a51d14; }
.inline-error { display: flex; flex-direction: column; gap: 6rpx; padding: 14rpx 22rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19rpx; background: #fff0ef; border-top: 2rpx solid #e5b8b4; }
.import-panel { padding: 20rpx 22rpx; background: #eef5f4; border-top: 2rpx solid #b8d6d1; }
.mapping-row { display: grid; grid-template-columns: 1fr auto 1fr 120rpx; gap: 12rpx; align-items: center; margin-top: 10rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20rpx; }
.import-actions { margin-top: 18rpx; }
.drawer-backdrop, .modal-backdrop { position: fixed; inset: 0; z-index: 20; background: rgba(24, 33, 38, .42); }
.edit-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 21; display: flex; flex-direction: column; width: min(680rpx, 88vw); background: #f8f9f9; border-left: 2rpx solid #b8c3c7; box-shadow: -12rpx 0 36rpx rgba(24, 33, 38, .18); }
.drawer-heading { padding: 20rpx 24rpx; font-size: 28rpx; border-bottom: 2rpx solid #d7dee1; }
.drawer-heading button { width: 58rpx; padding: 0; font-size: 32rpx; }
.drawer-fields { flex: 1; }
.field-row { display: grid; grid-template-columns: 180rpx minmax(160rpx, 1fr) 120rpx; gap: 12rpx; align-items: center; padding: 14rpx 22rpx; border-bottom: 2rpx solid #e0e5e7; }
.field-label { display: flex; flex-direction: column; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20rpx; }
.drawer-save { margin: 18rpx 22rpx; }
.modal-backdrop { display: flex; align-items: center; justify-content: center; }
.confirm-dialog { box-sizing: border-box; display: flex; flex-direction: column; gap: 18rpx; width: min(620rpx, 88vw); padding: 26rpx; background: #fff; border: 2rpx solid #cbd4d8; border-radius: 7rpx; }
.confirm-title { font-size: 28rpx; font-weight: 700; }
.mobile-table-select { display: none; }
@media (max-width: 720px) {
  .workspace-toolbar { align-items: flex-start; min-height: 176rpx; }
  .toolbar-actions { flex-wrap: wrap; justify-content: flex-end; max-width: 420rpx; }
  .workspace-layout { display: block; min-height: calc(100vh - 176rpx); }
  .table-sidebar { display: none; }
  .mobile-table-select { display: block; padding: 14rpx 18rpx; background: #e9edef; border-bottom: 2rpx solid #cbd4d8; }
  .mobile-table-strip { margin-top: 8rpx; white-space: nowrap; }
  .table-chip { display: inline-block; margin-right: 8rpx; }
  .table-chip.active { color: #fff; background: #177e6f; border-color: #177e6f; }
  .workspace-tabs { padding: 0 8rpx; overflow-x: auto; }
  .tab-button { min-width: 128rpx; }
  .data-tools { align-items: stretch; flex-direction: column; }
  .data-actions { flex-wrap: wrap; }
  .filter-bar { align-items: stretch; flex-wrap: wrap; }
  .filter-bar input { flex: 1 1 180rpx; }
  .schema-toolbar, .schema-form { align-items: stretch; flex-wrap: wrap; }
  .schema-row { grid-template-columns: minmax(150rpx, 2fr) 1fr auto; }
  .schema-row > text:nth-child(4) { display: none; }
  .edit-drawer { top: auto; left: 0; width: 100%; height: min(78vh, 980rpx); border-top: 2rpx solid #b8c3c7; border-left: 0; }
  .field-row { grid-template-columns: 140rpx minmax(120rpx, 1fr) 110rpx; }
  .activity-row { grid-template-columns: 110rpx 140rpx 1fr; }
}
`
