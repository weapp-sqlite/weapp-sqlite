export class SqliteClosedError extends Error {
  constructor() {
    super('SQLite database is already closed.')
    this.name = 'SqliteClosedError'
  }
}

export class SqliteTransactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SqliteTransactionError'
  }
}
