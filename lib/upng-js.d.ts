declare module "upng-js" {
  const upng: {
    encode(buffers: ArrayBuffer[], width: number, height: number, colors: number): ArrayBuffer;
  };
  export default upng;
}
