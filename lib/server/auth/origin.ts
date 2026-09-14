import { getAppOrigin } from "./config";
import { assertRequestOrigin } from "./request-origin";
export { SameOriginError } from "./request-origin";

export function assertSameOrigin(request:Request):void {
  assertRequestOrigin(request,getAppOrigin());
}
