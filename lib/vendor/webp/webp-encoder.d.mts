export interface WebPEncoder { encode(data: Uint8ClampedArray, width: number, height: number, options: Record<string, number>): Uint8Array | null; }
declare function factory(options: { wasmBinary: Uint8Array; noInitialRun: boolean; locateFile: (file: string) => string }): Promise<WebPEncoder>;
export default factory;
