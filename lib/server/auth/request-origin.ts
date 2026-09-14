export class SameOriginError extends Error {
  constructor(message:string){super(message);this.name="SameOriginError";}
}

export function assertRequestOrigin(request:Request,expected:string):void {
  if(["GET","HEAD","OPTIONS"].includes(request.method))return;
  const source=request.headers.get("origin");
  if(!source)throw new SameOriginError("Missing request origin");
  let origin:string;
  try{origin=new URL(source).origin;}catch{throw new SameOriginError("Invalid request origin");}
  if(origin!==expected)throw new SameOriginError("Cross-origin request denied");
}
