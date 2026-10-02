import { formatValue } from './state'

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) { node.textContent = text }
  return node
}

export function button(text: string, action: () => void | Promise<void>, className = '', disabled = false) {
  const node = element('button', className, text)
  node.type = 'button'
  node.disabled = disabled
  node.addEventListener('click', () => { void action() })
  return node
}

export function input(label: string, value = '', onInput?: (value: string) => void, multiline = false) {
  const control = multiline ? element('textarea') : element('input')
  control.value = value
  control.setAttribute('aria-label', label)
  control.addEventListener('input', () => onInput?.(control.value))
  return control
}

export function field(label: string, control: HTMLElement) {
  const node = element('label', 'field')
  node.append(element('span', 'field-label', label), control)
  return node
}

export function select(label: string, options: readonly { value: string, label: string }[], selected: string, onChange?: (value: string) => void) {
  const control = element('select')
  control.setAttribute('aria-label', label)
  for (const option of options) {
    const node = element('option', '', option.label)
    node.value = option.value
    node.selected = option.value === selected
    control.append(node)
  }
  control.addEventListener('change', () => onChange?.(control.value))
  return control
}

export function empty(title: string, detail: string) {
  const node = element('div', 'empty')
  node.append(element('div', 'empty-symbol', '▤'), element('h2', '', title), element('p', '', detail))
  return node
}

export function table(columns: readonly string[], rows: readonly Record<string, unknown>[], options: {
  sort?: (column: string) => void
  selectedRows?: Set<number>
  onSelect?: (index: number, checked: boolean) => void
  onEdit?: (index: number) => void
} = {}) {
  const wrapper = element('div', 'table-scroll')
  const grid = element('table', 'data-grid')
  const head = element('thead')
  const heading = element('tr')
  if (options.onSelect) { heading.append(element('th', 'selection-column', '')) }
  for (const column of columns) {
    const cell = element('th')
    cell.append(options.sort ? button(column, () => options.sort?.(column), 'column-sort') : document.createTextNode(column))
    heading.append(cell)
  }
  if (options.onEdit) { heading.append(element('th', '', '操作')) }
  head.append(heading)
  const body = element('tbody')
  rows.forEach((row, index) => {
    const tr = element('tr')
    if (options.onSelect) {
      const td = element('td', 'selection-column')
      const checkbox = element('input')
      checkbox.type = 'checkbox'
      checkbox.checked = options.selectedRows?.has(index) ?? false
      checkbox.setAttribute('aria-label', `选择第 ${index + 1} 行`)
      checkbox.addEventListener('change', () => options.onSelect?.(index, checkbox.checked))
      td.append(checkbox)
      tr.append(td)
    }
    for (const column of columns) {
      const value = row[column]
      const cell = element('td', value == null ? 'cell-null' : typeof value === 'number' || typeof value === 'bigint' ? 'cell-number' : value instanceof Uint8Array ? 'cell-blob' : '', formatValue(value))
      cell.title = formatValue(value)
      tr.append(cell)
    }
    if (options.onEdit) {
      const cell = element('td')
      cell.append(button('编辑', () => options.onEdit?.(index), 'text-button'))
      tr.append(cell)
    }
    body.append(tr)
  })
  grid.append(head, body)
  wrapper.append(grid)
  if (!rows.length) { wrapper.append(empty('没有匹配的数据', '调整筛选条件，或向当前表添加数据。')) }
  return wrapper
}

export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
  const anchor = element('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function dialog(title: string, content: HTMLElement, onSave: () => void | Promise<void>, saveLabel = '保存更改', danger = false) {
  const node = element('dialog', 'dialog')
  const heading = element('div', 'dialog-heading')
  heading.append(element('h2', '', title), button('关闭', () => node.close(), 'text-button'))
  const error = element('div', 'dialog-error')
  error.setAttribute('role', 'alert')
  const actions = element('div', 'dialog-actions')
  const submit = button(saveLabel, async () => {
    submit.disabled = true
    error.textContent = ''
    try { await onSave(); node.close() }
    catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause) }
    finally { submit.disabled = false }
  }, danger ? 'danger solid' : 'primary')
  actions.append(button('取消', () => node.close()), submit)
  node.append(heading, content, error, actions)
  node.addEventListener('close', () => node.remove())
  document.body.append(node)
  node.showModal()
  return node
}
