declare module 'pg' {
  export class Client {
    constructor(config: {
      host?: string
      port?: number
      database?: string
      user?: string
      password?: string
      ssl?: unknown
    })

    connect(): Promise<void>
    end(): Promise<void>

    query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>
  }
}
