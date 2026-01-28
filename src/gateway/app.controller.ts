import { Controller, Get, Post, Body, Inject } from "@nestjs/common";
import { EventsGateway } from "./events.gateway.js";

@Controller()
export class AppController {
  constructor(
    @Inject(EventsGateway) private readonly eventsGateway: EventsGateway
  ) {}

  @Get()
  getHello(): { message: string; timestamp: string } {
    return {
      message: "Hello from Gateway!",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ping")
  ping(): { ping: string } {
    return { ping: "pong" };
  }

  @Post("broadcast")
  broadcast(@Body() body: { text: string }): { success: boolean } {
    // 通过 HTTP 接口广播消息给所有 WebSocket 客户端
    this.eventsGateway.server.emit("message", {
      from: "server",
      text: body.text,
      timestamp: new Date().toISOString(),
    });
    return { success: true };
  }
}
