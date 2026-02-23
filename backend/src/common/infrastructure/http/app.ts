/* eslint-disable prettier/prettier */
// Express 5 handles async errors natively - express-async-errors not needed
import express from "express"
import cors from "cors"
import swaggerJSDOC from "swagger-jsdoc"
import swaggerUI from "swagger-ui-express"

import { routes } from "./routes.js"
import { errorHandler } from "./middlewares/errorHandler.js"

const options = {
  definition: {
    openapi: "3.0.0",
    info: { title: "Industrial Telemetry API", version: "1.0.0" },
  },
  apis: ["./src/**/http/routes/*.ts"],
}

const swaggerSpec = swaggerJSDOC(options)
const app = express()

app.use(cors())
app.use(express.json())

app.use("/docs", swaggerUI.serve, swaggerUI.setup(swaggerSpec))

app.use(routes)
app.use(errorHandler)

export { app }
