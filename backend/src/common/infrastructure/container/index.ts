/* eslint-disable prettier/prettier */
import { container } from 'tsyringe'
import { BcryptjsHashProvider } from '../providers/hash-provider/bycriptjs-hash.provider.js'
import { JwtAuthProvider } from '../providers/auth-providers/auth-provider.jwt.js'
import { GetHostMetricsUseCase } from '../../app/usecases/get-host-metrics.js'

/**
 * @file index.ts
 * @description
 * Registro central de dependências (Dependency Injection) usando `tsyringe`.
 *
 * Responsabilidades deste arquivo:
 * 1) Importar os "containers" (módulos de registro) de cada bounded context
 *    (ex: products/users/customers), garantindo que os bindings do módulo sejam carregados.
 * 2) Registrar providers globais compartilhados por toda aplicação (ex: HashProvider, AuthProvider).
 *
 * Em uma Clean Architecture, este arquivo pertence à borda (Infrastructure),
 * pois define as implementações concretas que serão injetadas em ports/interfaces
 * definidos em camadas internas (Domain/Application).
 *
 * Observação importante:
 * - Apenas o ato de `import`ar os containers dos módulos já dispara a execução
 *   do código de registro desses módulos (efeito colateral intencional).
 */

/**
 * Registra o provider responsável por hashing (ex: senhas).
 *
 * Token: 'HashProvider'
 * Implementação: `BcryptjsHashProvider`
 *
 * Este binding permite que casos de uso e serviços dependam de uma abstração
 * e recebam uma implementação concreta via DI.
 */
container.registerSingleton('HashProvider', BcryptjsHashProvider)

/**
 * Registra o provider responsável por autenticação (ex: geração e verificação de token JWT).
 *
 * Token: 'IAuthProvider'
 * Implementação: `JwtAuthProvider`
 *
 * Observação:
 * - O nome do token deve bater exatamente com o que você usa nos `@inject('...')`
 *   em controllers/usecases/services.
 */
container.registerSingleton('IAuthProvider', JwtAuthProvider)
container.registerSingleton('GetHostMetricsUseCase', GetHostMetricsUseCase)

/**
 * Importa e executa o container do módulo Users.
 * O ato de importar já registra todos os bindings do módulo.
 */
import '../../../users/infrastructure/container/index.js'

/**
 * Importa e executa o container do modulo Telemetry.
 * O ato de importar ja registra todos os bindings do modulo.
 */
import '../../../telemetry/infrastructure/container/index.js'
import '../../../alerts/infrastructure/container/index.js'
