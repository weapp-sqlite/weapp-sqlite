interface ImportMetaEnv {
  readonly PLATFORM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare function App(options: Record<string, unknown>): void
interface WeappPageThis<Data extends Record<string, unknown>> {
  data: Data
  setData: (data: Partial<Data>) => void
}

declare function Page<Data extends Record<string, unknown>>(
  options: { data: Data, [key: string]: unknown } & ThisType<WeappPageThis<Data>>,
): void
