/** Hello Action - 测试用的问候消息 */

export const HelloAction = "hello" as const;
export const HelloResponseAction = "hello_response" as const;

/** Hello 请求 payload */
export interface HelloPayload {
  greeting: string;
}

/** Hello 响应 payload */
export interface HelloResponsePayload {
  reply: string;
}
