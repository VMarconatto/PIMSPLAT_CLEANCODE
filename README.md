<div align="center">

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║        ██████╗ ██╗███╗   ███╗███████╗    ██████╗ ██╗      █████╗ ████████╗   ║
║        ██╔══██╗██║████╗ ████║██╔════╝    ██╔══██╗██║     ██╔══██╗╚══██╔══╝   ║
║        ██████╔╝██║██╔████╔██║███████╗    ██████╔╝██║     ███████║   ██║      ║
║        ██╔═══╝ ██║██║╚██╔╝██║╚════██║    ██╔═══╝ ██║     ██╔══██║   ██║      ║
║        ██║     ██║██║ ╚═╝ ██║███████║    ██║     ███████╗██║  ██║   ██║      ║
║        ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝    ╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝      ║
║                                                                              ║
║                 Industrial PIMS — OPC-UA · RabbitMQ · PostgreSQL             ║
║                          Clean Architecture  |  Beta Rev. 2                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.x-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![OPC-UA](https://img.shields.io/badge/OPC--UA-node--opcua-green?style=for-the-badge)](https://github.com/node-opcua/node-opcua)
[![Status](https://img.shields.io/badge/Status-Beta%20Rev.2-orange?style=for-the-badge)]()

</div>

---

## `>_` O que é este projeto?

> **Este repositório tem propósito didático** — é material de referência para o desenvolvimento de um **PIMS Industrial** (*Plant Information Management System*) com uma arquitetura de tecnologia profissional, voltada a ambientes de chão de fábrica reais.

Um **PIMS** é o intermediador entre o **chão de fábrica** (PLCs, sensores, atuadores via OPC-UA) e sistemas superiores como **MES** (*Manufacturing Execution System*) e **ERP**. Este projeto implementa essa camada com foco em:

- **Confiabilidade** — transporte de dados via message broker com garantia de entrega
- **Escalabilidade** — arquitetura multi-client e multi-área desde o princípio
- **Rastreabilidade** — persistência em banco de dados relacional com timestamps precisos
- **Manutenibilidade** — Clean Architecture com separação estrita de responsabilidades

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   CHÃO DE FÁBRICA          PIMS (este projeto)           SISTEMAS SUPERIORES│
│                                                                             │
│  ┌──────────────┐     ┌──────────────────────────┐     ┌─────────────────┐  │
│  │  PLC / SCADA │────▶│  OPC-UA → RabbitMQ       │────▶│  MES / ERP     │  │
│  │  Sensores    │     │  Coleta · Transporte     │     │  Relatórios     │  │
│  │  Atuadores   │◀────│  Persistência · Alarmes  │◀─── │  BI / Analytics│  │
│  └──────────────┘     └──────────────────────────┘     └─────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **Nota sobre este repositório:** Este repositório foi criado como uma melhoria do Repositório OpcuaMultiClient, com refatoração de código e arquitetura, por tanto, o foco é no backend. O frontend tevve algumas melhorias, mas nada de tão diferente quanto ao primeiro repositório. Alguns módulos de produção como telemetry não foram versionados por fazerem parte de um desenvolvimento maior e proprietário. As partes versionadas incluem **Script de Inicialização**, toda a **camada RabbitMQ**, a **configuração Docker Compose completa**, e o **Módulo de Alertas** e o **Módulo Commom para todos os modulos da aplicação**. Os demais arquivos são representações estruturais que ilustram e facilitam o entendimento da arquitetura, servindo como material didático.

---

## `>_` Arquitetura do Sistema

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                     VISÃO GERAL DA ARQUITETURA                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌─────────────────────────────────────────────────────────────────────┐    ║
║   │                        FRONTEND (React 19)                          │    ║
║   │     Dashboard · Alarmes · OPC-UA Setup · Configuração de Ranges     │    ║
║   │                  React Router v7 · Styled Components                │    ║
║   └───────────────────────────────┬─────────────────────────────────────┘    ║
║                                   │ HTTP/REST (JWT Auth)                     ║
║   ┌───────────────────────────────▼─────────────────────────────────────┐    ║
║   │                    BACKEND — Express API                            │    ║
║   │                   Clean Architecture (4 módulos)                    │    ║
║   │                                                                     │    ║
║   │   ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────────┐    │    ║ 
║   │   │  common/    │  │ telemetry/  │  │  users/  │  │  alerts/   │    │    ║
║   │   │  (base DI,  │  │ (OPC-UA,    │  │  (Auth,  │  │  (Alarmes, │    │    ║ 
║   │   │   erros,    │  │  history,   │  │   JWT,   │  │   email,   │    │    ║
║   │   │  TypeORM)   │  │  setups)    │  │  CRUD)   │  │  rate-lim) │    │    ║
║   │   └─────────────┘  └──────┬──────┘  └──────────┘  └────────────┘    │    ║
║   └──────────────────────────────────────────────────────────────────────    ║
║                               │                                              ║
║                               │ AMQP 0-9-1 (publish)                         ║
║   ┌───────────────────────────▼────────────────────────────────────────┐     ║
║   │                   🐇 RabbitMQ (Docker)                             │     ║
║   │              topic exchange: telemetry.exchange                    │     ║
║   │                                                                    │     ║
║   │   Routing Key: telemetry.[área].[host_id].[linha].[tag]            │     ║
║   │                                                                    │     ║
║   │   ┌──────────────────────────────────────────────────────────────┐ │     ║
║   │   │  Queue: pasteurizacao  │  utilidades  │  recepcao  │  ...    │ │     ║
║   │   └──────────────────────────────────────────────────────────────┘ │     ║
║   └───────────┬──────────────────────┬─────────────────┬───────────────┘     ║
║               │ consume              │ consume         │ consume             ║
║   ┌───────────▼──────┐   ┌───────────▼──────┐  ┌───────▼──────────────┐      ║
║   │ Consumer Worker  │   │ Consumer Worker  │  │  Consumer Worker     │      ║
║   │  (Pasteurização) │   │  (Utilidades)    │  │  (Recepção / ...)    │      ║
║   └───────────┬──────┘   └───────────┬──────┘  └───────┬──────────────┘      ║
║               │ persist              │ persist         │ persist             ║
║   ┌───────────▼──────┐   ┌───────────▼──────┐  ┌───────▼──────────────┐      ║
║   │  PostgreSQL      │   │  PostgreSQL      │  │  PostgreSQL          │      ║
║   │  :5432           │   │  :5433           │  │  :5434 / :5435 / ... │      ║
║   │  (Docker)        │   │  (Docker)        │  │  (Docker)            │      ║
║   └──────────────────┘   └──────────────────┘  └──────────────────────┘      ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## `>_` Arquitetura Clean Code — Estrutura dos Módulos

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    CLEAN ARCHITECTURE — CAMADAS POR MÓDULO                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ┌───────────────────────────────────────────────────────────────────────┐   ║
║  │  Module: telemetry/  (mesmo padrão em: users/ · alerts/ · common/)    │   ║
║  │                                                                       │   ║
║  │  ┌─────────────────────────────────────────────────────────────────┐  │   ║
║  │  │  DOMAIN  (núcleo — zero dependências externas)                  │  │   ║
║  │  │  ├── models/         OpcuaTagSetup, OpcuaClientProfile, ...     │  │   ║
║  │  │  ├── repositories/   Interfaces (contratos abstratos)           │  │   ║
║  │  │  ├── policies/       Regras de negócio puras                    │  │   ║
║  │  │  └── errors/         Erros de domínio específicos               │  │   ║
║  │  └─────────────────────────────────────────────────────────────────┘  │   ║
║  │         ▲  (depende apenas da camada acima)                           │   ║
║  │  ┌──────┴──────────────────────────────────────────────────────────┐  │   ║
║  │  │  APPLICATION  (casos de uso — orquestra o domínio)              │  │   ║
║  │  │  ├── usecases/       CreateTagSetup, UpdateAlarmSetpoints, ...  │  │   ║
║  │  │  ├── dtos/           Objetos de transferência de dados          │  │   ║
║  │  │  └── launchers/      OpcuaInitializer, SetupInitializer         │  │   ║
║  │  └─────────────────────────────────────────────────────────────────┘  │   ║
║  │         ▲  (depende apenas das camadas acima)                         │   ║
║  │  ┌──────┴──────────────────────────────────────────────────────────┐  │   ║
║  │  │  INFRASTRUCTURE  (implementações concretas — pode ser trocada)  │  │   ║
║  │  │  ├── typeorm/        Entities, Repositories (raw SQL)           │  │   ║
║  │  │  ├── opcua/          node-opcua client, main collector          │  │   ║
║  │  │  ├── http/           Express Controllers, Routes                │  │   ║
║  │  │  └── container/      TSyringe — factories de injeção            │  │   ║
║  │  └─────────────────────────────────────────────────────────────────┘  │   ║ 
║  └───────────────────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## `>_` Stack de Tecnologias

### Backend

| Tecnologia | Função | Versão |
|---|---|---|
| **Node.js** | Runtime de servidor | 22.x |
| **TypeScript** | Tipagem estática, ES2022 modules | 5.x |
| **Express 5** | Framework HTTP, API REST | 5.x |
| **node-opcua** | Cliente OPC-UA industrial | 2.x |
| **amqplib** | Driver AMQP para RabbitMQ | 0.5.x |
| **TypeORM** | ORM — migrations e queries | 0.3.x |
| **TSyringe** | Injeção de dependência (DI Container) | 4.x |
| **Zod** | Validação de schemas e env vars | 4.x |
| **jsonwebtoken** | Autenticação JWT | 9.x |
| **bcryptjs** | Hash seguro de senhas | 3.x |
| **Pino** | Logger estruturado de alta performance | 10.x |
| **Nodemailer** | Envio de alertas por e-mail | 8.x |

### Infraestrutura

| Tecnologia | Função |
|---|---|
| **Docker** | Containerização de serviços |
| **Docker Compose** | Orquestração local multi-container |
| **RabbitMQ** | Message Broker com Management UI |
| **PostgreSQL 16** | Banco de dados relacional (6 instâncias) |

---

## `>_` Docker — O Coração da Infraestrutura

```
╔══════════════════════════════════════════════════════════════════════════════╗
║             DOCKER COMPOSE — TOPOLOGIA DE CONTAINERS                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌─────────────────────────────────────────────────────────────────────┐    ║
║   │  docker-compose.yml  (9 containers ativos)                          │    ║
║   │                                                                     │    ║
║   │   rabbitmq          ─── AMQP :5672 · Management UI :15672           │    ║
║   │                                                                     │    ║
║   │   postgres_past     ─── :5432  (Pasteurização)                      │    ║
║   │   postgres_util     ─── :5433  (Utilidades)                         │    ║
║   │   postgres_rec      ─── :5434  (Recepção)                           │    ║
║   │   postgres_estoc    ─── :5435  (Estocagem de Leite Cru)             │    ║
║   │   postgres_exp      ─── :5436  (Expedição de Creme)                 │    ║
║   │   postgres_als      ─── :5437  (Alsafe)                             │    ║
║   │                                                                     │    ║
║   │   consumer_past     ─── Worker → consume telemetry.pasteurizacao    │    ║
║   │   consumer_util     ─── Worker → consume telemetry.utilidades       │    ║
║   │   ...                                                               │    ║
║   └─────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### Por que Docker em ambientes industriais de chão de fábrica?

O uso de Docker neste projeto não é apenas uma escolha técnica — é uma **decisão arquitetural estratégica** com impacto direto na operação industrial:

**`#` Isolamento e Reproducibilidade**
> Cada instância do PostgreSQL roda em seu próprio container isolado. Problemas em uma área de produção (ex: Pasteurização) não afetam as demais (Utilidades, Recepção etc.). O ambiente local de desenvolvimento é **idêntico** ao de produção.

**`#` Deploy sem Fricção**
> Um único comando `docker compose up -d` sobe toda a infraestrutura: RabbitMQ + bancos PostgreSQL + consumers. Sem instalações manuais, sem configurações de sistema. Qualquer engenheiro com Docker pode replicar o ambiente em minutos.

**`#` Escalabilidade Horizontal**
> Adicionar uma nova área de produção (ex: Homogeneização) significa **duplicar um serviço no docker-compose.yml**. O container herda todas as configurações via variáveis de ambiente. Sem risco de configuração manual errada.

**`#` Dados Persistentes e Seguros**
> Os volumes Docker garantem que os dados do PostgreSQL **sobrevivem ao ciclo de vida dos containers**. Restart, upgrade, recriação — os dados permanecem intactos. Crítico em ambientes industriais onde a perda de histórico pode gerar não-conformidades.

**`#` Serviços com Isolamento e Tolerância a Falhas**
> Cada Consumer Worker é um **processo independente**, com sua própria memória e conexão de banco dedicada — seguindo o princípio de *responsabilidade única* e *dados descentralizados* da arquitetura orientada a serviços. Falha de um consumer não cascateia para os demais. O RabbitMQ garante que as mensagens pendentes sejam processadas quando o consumer reiniciar. Esta abordagem segue os **princípios de microserviços** (isolamento, baixo acoplamento, banco por serviço), implementada como *processos de sistema* no host físico — um padrão híbrido comum em ambientes industriais onde a latência de container é indesejável para coleta de dados em tempo real.

**`#` Monitoramento Centralizado**
> O RabbitMQ Management UI (`:15672`) oferece visibilidade completa das filas, taxa de mensagens e consumers ativos — essencial para diagnóstico em campo sem acesso a ferramentas externas.

---

## `>_` Fluxo de Dados — Da Fábrica ao Dashboard

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    FLUXO COMPLETO DE TELEMETRIA                            │
│                                                                            │
│  1. COLETA (OPC-UA)                                                        │
│  ─────────────────                                                         │
│  ┌────────────────┐                                                        │
│  │ OpcuaInitializ │  ← Carrega perfis de cliente do banco / JSON           │
│  │ er.ts          │                                                        │
│  └───────┬────────┘                                                        │
│          │ node-opcua subscription                                         │
│  ┌───────▼────────┐                                                        │
│  │ client.ts      │  ← Multiclient: múltiplos servidores OPC-UA            │
│  │ (node-opcua)   │    Cada cliente monitora seus NodeIds                  │
│  └───────┬────────┘                                                        │
│                                                                            │
│  2. TRANSPORTE (RabbitMQ)                                                  │
│  ─────────────────────────                                                 │
│          │ publish                                                         │
│  ┌───────▼────────┐                                                        │
│  │ publisher.ts   │  topic: telemetry.pasteurizacao.client01.line.FT01     │
│  └───────┬────────┘                                                        │
│          │                                                                 │
│  ┌───────▼───────────────────────────────────────────────────────────┐     │
│  │               🐇 RabbitMQ Exchange (topic)                        │     │
│  │  Garantia de entrega · Dead-letter queues · Retry policy          │     │
│  └───────┬───────────────────────────────────────────────────────────┘     │
│                                                                            │
│  3. PROCESSAMENTO (Consumer)                                               │
│  ───────────────────────────                                               │
│          │ consume                                                         │
│  ┌───────▼────────┐                                                        │
│  │ consumer.ts    │  ← Valida, normaliza e persiste                        │
│  │                │    Verifica alarmes e dispara alertas                  │
│  └───────┬────────┘                                                        │
│                                                                            │
│  4. PERSISTÊNCIA (PostgreSQL)                                              │
│  ────────────────────────────                                              │
│          │ INSERT                                                          │
│  ┌───────▼────────┐                                                        │
│  │ telemetry_     │  ← Série temporal: tag, valor, timestamp, site         │
│  │ samples        │    Migrations via TypeORM                              │
│  └───────┬────────┘                                                        │
│                                                                            │
│  5. VISUALIZAÇÃO (Frontend React)                                          │
│  ──────────────────────────────                                            │
│          │ GET /api/telemetry/:clientId/history                            │
│  ┌───────▼────────┐                                                        │
│  │ Dashboard      │  ← Recharts · Realtime SSE · Filtros por área          │
│  │ (React 19)     │                                                        │
│  └────────────────┘                                                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## `>_` Multi-Client OPC-UA

Uma das características centrais deste PIMS é a capacidade de gerenciar **múltiplos clientes OPC-UA simultaneamente**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     GERENCIADOR MULTI-CLIENT OPC-UA                     │
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐    │
│   │   Client01      │    │   Client02      │    │   Client03       │    │
│   │  opc.tcp://     │    │  opc.tcp://     │    │  opc.tcp://      │    │
│   │  plc01:4840     │    │  plc02:4840     │    │  pasteuriz:4840  │    │
│   │                 │    │                 │    │                  │    │
│   │  mapMemory:     │    │  mapMemory:     │    │  mapMemory:      │    │
│   │  [FT01, PT01,   │    │  [LT01, LT02,   │    │  [CT01, CT02,    │    │
│   │   PT04, ...]    │    │   PT07, ...]    │    │   FT03, ...]     │    │
│   └────────┬────────┘    └────────┬────────┘    └────────┬─────────┘    │
│            │                      │                       │             │
│            └──────────────────────┴───────────────────────┘             │
│                                   │                                     │
│                          publish to RabbitMQ                            │
│                    telemetry.{área}.{clientId}.{linha}.{tag}            │
└─────────────────────────────────────────────────────────────────────────┘
```

Cada cliente OPC-UA é configurado individualmente com:
- **Endpoint** de conexão (`opc.tcp://host:porta`)
- **NodeIds** a monitorar (`mapMemory`)
- **Políticas de segurança** (securityMode, securityPolicy)
- **Parâmetros de retry** (initialDelay, maxRetry, maxDelay)
- **Namespace** OPC-UA do servidor

---

## `>_` Injeção de Dependência com TSyringe

O projeto utiliza **TSyringe** como container de injeção de dependência, seguindo o padrão de **factory functions** para garantir que as instâncias sejam criadas com suas dependências corretamente resolvidas:

```typescript
// Pattern DI — cada módulo registra suas dependências
container.registerSingleton('OpcuaTagSetupRepository', OpcuaTagSetupTypeormRepository)

container.register('CreateTagSetupUseCase', {
  useFactory: (c) => new CreateTagSetupUseCase(
    c.resolve('OpcuaTagSetupRepository')
  )
})

// No controller — resolve o use case pronto para uso:
const useCase = container.resolve<CreateTagSetupUseCase>('CreateTagSetupUseCase')
```

Benefícios desta abordagem:
- **Zero acoplamento** entre camadas — o controller não conhece a implementação do repositório
- **Testabilidade** — repositórios podem ser trocados por mocks em testes
- **Configuração centralizada** — todo o grafo de dependências em um único arquivo `container/index.ts`

---

## `>_` TypeORM — Gerenciamento Profissional de Banco de Dados

O TypeORM é utilizado com **raw SQL via QueryRunner**, combinando o melhor dos dois mundos:

```
Migrations controladas    +    Queries SQL explícitas
     (TypeORM)                       (raw SQL)
         │                               │
         ▼                               ▼
Versionamento do schema          Performance máxima
Rollback automático              Sem overhead do ORM
Deploy reproduzível              Queries otimizadas
```

**Migrations disponíveis:**

```
1768323320214 — CreateOpcuaClients
1768676034633 — CreateUsers
1768847601673 — CreateUserTokens
1769012345678 — CreateAlertsSamples
1771632000000 — AddColumnsToOpcuaClients
1771718400000 — CreateOpcuaTagSetups
```

---

## `>_` Estrutura de Diretórios

```
typescript-rabbitmq-master/
│
├── docker-compose.yml              ← Infraestrutura completa (RabbitMQ + 6x Postgres)
├── .env                            ← Variáveis de ambiente
│
├── backend/
│   └── src/
│       ├── common/                 ← Base compartilhada (DI, erros, TypeORM, auth)
│       │   ├── domain/errors/      ← AppError, NotFoundError, ConflictError...
│       │   ├── domain/providers/   ← Interfaces: AuthProvider, HashProvider
│       │   ├── infrastructure/
│       │   │   ├── container/      ← TSyringe: registro de dependências globais
│       │   │   ├── http/           ← Express app, server, middlewares JWT
│       │   │   ├── providers/      ← JWT e bcryptjs implementations
│       │   │   └── typeorm/        ← DataSource + migrations
│       │   └── system/             ← Health check, email alerts
│       │
│       ├── telemetry/              ← Módulo principal: OPC-UA + persistência
│       │   ├── domain/             ← Models, repositories interfaces, policies
│       │   ├── app/usecases/       ← CRUD de setups, histórico, snapshot realtime
│       │   └── infrastructure/
│       │       ├── opcua/          ← node-opcua client + initializer
│       │       ├── typeorm/        ← Repositórios com raw SQL
│       │       ├── http/           ← Controllers + rotas REST
│       │       └── container/      ← DI factories do módulo
│       │
│       ├── messaging/              ← Camada RabbitMQ (transporte de dados)
│       │   ├── rabbitmq.connection.ts  ← AMQP connection management
│       │   ├── rabbitmq.setup.ts       ← Topology: exchanges, queues, bindings
│       │   ├── publisher.ts            ← Publica telemetria no exchange
│       │   ├── consumer.ts             ← Processa mensagens e persiste
│       │   └── retry.ts                ← Dead-letter e retry policy
│       │
│       ├── alerts/                 ← Módulo de alarmes e notificações
│       │   ├── domain/policies/    ← rateLimitPolicy (anti-spam de alertas)
│       │   └── infrastructure/     ← Persistência + e-mail via Nodemailer
│       │
│       └── users/                  ← Módulo de autenticação e usuários
│           ├── domain/entities/    ← User entity
│           └── infrastructure/     ← JWT auth, bcrypt, routes
│
└── frontend/
    └── src/
        ├── pages/                  ← Dashboard, Alarms, OpcuaSetup, RangeSetup...
        ├── components/             ← OpcuaBox, RabbitMQBox, HostMetrics, Charts...
        ├── hooks/                  ← useAuth, useTheme
        ├── styles/themes/          ← dark.ts / light.ts
        └── routes/                 ← Protected routes (JWT) + auth routes
```

---

## `>_` Páginas do Frontend

| Rota | Página | Descrição |
|---|---|---|
| `/dashboard` | **Analytics** | Dashboard principal com histórico, gráficos Recharts, filtros por área e período |
| `/metrics` | **AppMetrics** | Métricas do sistema: host, RabbitMQ, OPC-UA, banco de dados |
| `/alarms` | **AlarmsList** | Lista em tempo real de alarmes ativos por área e tag |
| `/alertssent` | **AlertsSent** | Histórico de alertas enviados por e-mail com timestamps |
| `/opcuaclients` | **OpcuaClientList** | Gerenciamento de perfis de cliente OPC-UA (CRUD) |
| `/analogsetup` | **AnalogsSetup** | Configuração de setpoints de alarme (L, LL, H, HH) por tag |

---

## `>_` Como Executar

### Pré-requisitos

```bash
node --version    # >= 22.x
docker --version  # >= 25.x
```

### 1. Subir a Infraestrutura Docker

```bash
# Na raiz do projeto
docker compose up -d --wait

# Verificar status
docker compose ps
```

Aguarda até que todos os health checks passem (`--wait`). O RabbitMQ Management UI estará disponível em `http://localhost:15672` (user: `guest` / pass: `guest`).

### 2. Configurar Variáveis de Ambiente

```bash
cp .env .env.local
```

Variáveis essenciais:

```bash
RABBITMQ_URL=amqp://guest:guest@localhost:5672
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASS=postgres
JWT_SECRET=seu_secret_aqui
SITE=NomeDaArea
HOST_ID=Client01
```

### 3. Backend — Build e Start

```bash
cd backend
npm install
npm run build
npm run start:api        # API Express (:3000)
npm run start:collector  # Coletor OPC-UA
npm run start:consumer   # Consumer RabbitMQ
# ou tudo junto:
npm run start:stack
```

### 4. Frontend — Dev Server

```bash
cd frontend
npm install
npm start    # http://localhost:3001
```

### 5. Migrations

```bash
cd backend
npm run typeorm migration:run
```

---

## `>_` Variáveis de Ambiente — Referência

| Variável | Descrição | Padrão |
|---|---|---|
| `RABBITMQ_URL` | URL de conexão AMQP | `amqp://guest:guest@localhost:5672` |
| `RABBITMQ_EXCHANGE` | Nome do exchange topic | `telemetry.exchange` |
| `RABBITMQ_ROUTING_KEY` | Padrão de routing key | `telemetry.#` |
| `RABBITMQ_PREFETCH` | Mensagens em paralelo por consumer | `50` |
| `OPCUA_ENABLE_RABBIT` | Habilita publish RabbitMQ | `true` |
| `SITE` | Slug da área de produção | `Utilidades` |
| `HOST_ID` | Identificador do host OPC-UA | `Client01` |
| `DB_HOST` | Host PostgreSQL | `localhost` |
| `DB_PORT` | Porta PostgreSQL | `5432` |
| `JWT_SECRET` | Chave de assinatura JWT | — |
| `JWT_EXPIRES_IN` | TTL do token (segundos) | `86400` |
| `ALERT_EMAIL_USER` | Conta SMTP para alertas | — |
| `ALERT_EMAIL_DESTINATION` | Destinatário dos alertas | — |

---

## `>_` Contexto Industrial

Este projeto foi desenvolvido como material de referência para uma **planta de processamento de laticínios**, com as seguintes áreas de produção monitoradas:

```
┌──────────────────────────────────────────────────────────────────────┐
│              ÁREAS DE PRODUÇÃO MONITORADAS                           │
│                                                                      │
│   Pasteurização        ─── Fluxo, Pressão, Temperatura, CIP          │
│   Utilidades           ─── Caldeira, Compressores, Água Gelada       │
│   Recepção             ─── Tanques de recepção de leite cru          │
│   Estocagem Leite Cru  ─── Nível, Pressão, Condutividade             │
│   Expedição de Creme   ─── Vazão, Temperatura, Peso                  │
│   Alsafe               ─── Sistemas de segurança e utilidades        │
└──────────────────────────────────────────────────────────────────────┘
```

**Tags instrumentadas (exemplos):**

| Tag | Descrição | Unidade | Alarmes |
|---|---|---|---|
| `FT01` | Baia 01 — Vazão de saída | m³/h | L=10, HH=42 |
| `PT04` | Baia 01 — Pressão saída de linha | bar | LL=2, HH=11 |
| `LT01` | Tanque 1 — Nível de Leite Cru | % | L=20, LL=10, HH=94 |
| `CT01` | Manifold — Condutividade | mS/cm | L=30, LL=20, HH=60 |
| `PT07` | Tanque 1 — Pressão | bar | HH=4.9 |

---

## `>_` Próximas Evoluções (Roadmap)

```
[✓] Dashboard realtime via SSE (Server-Sent Events)
[✓] Alarmes com níveis L / LL / H / HH configuráveis por tag
[✓] Multi-tenant: isolamento por área via routing key RabbitMQ
[✓] Autenticação JWT com refresh token
[ ] Migração de opcuaClientConfig.json → tabela opcua_clients (em andamento)
[ ] OpcuaInitializer lendo perfis do banco de dados
[ ] Testes unitários por módulo (jest + testcontainers)
[ ] CI/CD pipeline (GitHub Actions)
[ ] Integração MES via REST/MQTT
```

---

## `>_` Licença

```
MIT License — use, estude, adapte e compartilhe.

Este repositório é material didático aberto. Se este projeto
te ajudou a entender PIMS industrial, Clean Architecture ou
integração OPC-UA/RabbitMQ — uma estrela no repositório é
muito bem-vinda. ⭐
```

---

<div align="center">

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Desenvolvido com foco em educação e boas práticas           ║
║   para engenharia de software em ambientes industriais        ║
║                                                               ║
║        OPC-UA  ·  RabbitMQ  ·  PostgreSQL  ·  Docker          ║
║          Clean Architecture  ·  TypeScript  ·  React          ║
║                                                               ║
║                      Beta Rev. 2  —  2026                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

</div>

---

## `>_` Screenshots do Frontend

**Imagem 1 — Configuração de Cliente OPC-UA**

![OPCUA Client Configuration](screenshots/Post_Opcua_Perfil.png)

Formulário completo de cadastro de um cliente OPC-UA. Permite definir o nome da aplicação, endpoint de conexão (`opc.tcp://`), parâmetros de retry (Initial Delay, Max Retry, Max Delay), modo e política de segurança, namespace do servidor, e o `Map Memory` — lista de NodeIds (tags) que o cliente irá monitorar. Os dados podem ser salvos no banco de dados ou exportados como JSON.

---

**Imagem 2 — Load Connection Profile**

![Load Connection Profile](screenshots/Load%20Connection%20Profile.png)

Modal de carregamento de perfis de conexão OPC-UA. Exibe os perfis disponíveis em duas fontes distintas: banco de dados PostgreSQL (Database) e arquivos JSON locais (`backend/src/`). Cada perfil pode ser carregado diretamente no formulário de configuração com um clique em **Load**, permitindo alternar rapidamente entre diferentes clientes sem redigitar os dados.

---

**Imagem 3 — Load Setup Configuration**

![Load Setup Configuration](screenshots/Load%20Setup%20Configuration.png)

Modal de carregamento de configurações de setup de tags OPC-UA. Assim como o perfil de conexão, as configurações de variáveis analógicas (setpoints, unidades, descrições) podem ser carregadas tanto do banco de dados (`opcua_tag_setups`) quanto de arquivos JSON locais. Garante portabilidade e versionamento das configurações de planta.

---

**Imagem 4 — Analog Variable Settings**

![Analog Variable Settings](screenshots/Analog%20Variable%20Settings.png)

Página de configuração de variáveis analógicas por cliente OPC-UA. Lista todas as tags monitoradas (CT01, CT02, FT01, FT02...) com campos editáveis para unidade de engenharia, descrição e os quatro níveis de setpoint de alarme: **SP ALARM L** (Low), **SP ALARM LL** (Low-Low), **SP ALARM H** (High) e **SP ALARM HH** (High-High). É a interface central para parametrização dos limites de alarme da planta.

---

**Imagem 5 — Service Metrics**

![Service Metrics](screenshots/Service%20Metrics.png)

Página de métricas do sistema (AppMetrics). Exibe em tempo real o status do coletor OPC-UA, métricas do host (CPU, uso de memória RAM), e o painel de gerenciamento do **RabbitMQ Management UI** embarcado na interface, mostrando os channels AMQP ativos, filas, taxa de publicação e consumo de mensagens — essencial para diagnóstico operacional sem sair do sistema.

---

**Imagem 6 — Analog Dashboard**

![Analog Dashboards](screenshots/Analog%20Dashboards.png)

Dashboard principal de telemetria. Apresenta gráficos de série temporal (Recharts) para múltiplas tags analógicas simultaneamente, com filtros por área de produção (Pasteurização, Utilidades, Recepção etc.) e intervalo de tempo. Inclui um gráfico de distribuição de falhas por tag (donut chart), configuração de cores individuais por variável e indicadores de produção acumulada — visão consolidada do chão de fábrica em tempo real.
