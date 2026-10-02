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

/** The transaction committed in memory, but its snapshot was not saved. */
export class SqlitePersistenceError extends Error {
  readonly committed = true

  constructor(options: ErrorOptions) {
    super('SQLite transaction committed, but persistence failed. Retry flush() without repeating the transaction.', options)
    this.name = 'SqlitePersistenceError'
  }
}
