/**
 * @openim/client-sdk 3.8.3 的打包缺陷：
 *   import { PullOrder } from "@openim/protocol/lib/pb/sdkws/sdkws"
 * 但 @openim/protocol 只发布了该路径的 .d.ts，没有 .js。
 * 运行时 enum 实际挂在根导出的 SdkWsProto.PullOrder 上，这里做个别名转发。
 */
import { SdkWsProto } from "@openim/protocol";

export const PullOrder = SdkWsProto.PullOrder;
export default { PullOrder };
