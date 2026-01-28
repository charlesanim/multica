import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const port = process.env["PORT"] ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Gateway is running on http://localhost:${port}`);
  logger.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
}

bootstrap().catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
