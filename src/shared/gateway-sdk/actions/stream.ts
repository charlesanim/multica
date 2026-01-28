/** Stream Action - 流式消息传输 */

export const StreamAction = "stream" as const;

/** 流消息 payload */
export interface StreamPayload<T = unknown> {
  /** 流 ID，用于关联同一个流的所有消息 */
  streamId: string;
  /** 数据 */
  data: T;
}
