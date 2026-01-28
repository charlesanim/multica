import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { EventsGateway } from "./events.gateway.js";
import { AppController } from "./app.controller.js";

const isDev = process.env.NODE_ENV !== "production";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                singleLine: true,
              },
            },
            level: process.env.LOG_LEVEL ?? "debug",
          }
        : {
            level: process.env.LOG_LEVEL ?? "info",
          },
    }),
  ],
  providers: [EventsGateway],
  controllers: [AppController],
})
export class AppModule {}
