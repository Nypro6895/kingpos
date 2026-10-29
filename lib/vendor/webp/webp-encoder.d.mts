export interface WebPEncoder { encode(data: Uint8ClampedArray, width: number, height: number, options: Record<string, number>): Uint8Array | null; }
declare function factory(options: { noInitialRun: boolean; locateFile: (file: string) => string; instantiateWasm: (imports: Record<string, Record<string, unknown>>, receive: (instance: {exports: Record<string, unknown>}) => void) => Record<string, unknown> }): Promise<WebPEncoder>;
export default factory;
