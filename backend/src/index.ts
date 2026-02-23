import { startApp } from './app.js'

/**
 * @file index.ts
 * @description
 * Entry-point do Node dentro do container.
 * - chama startApp()
 * - se falhar, encerra o processo (orquestrador reinicia o container)
 */
startApp().catch((err) => {
  // em container, crashar é ok (orquestrador reinicia)
  // mas logar bem é essencial
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
