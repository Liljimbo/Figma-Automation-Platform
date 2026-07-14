declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG(imgd: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): string;
  };
  export default ImageTracer;
}

declare module 'imagetracerjs/nodecli/PNGReader.js' {
  class PNGReader {
    constructor(bytes: Buffer);
    parse(callback: (err: Error | null, png: { width: number; height: number; pixels: Uint8ClampedArray }) => void): void;
  }
  export default PNGReader;
}
