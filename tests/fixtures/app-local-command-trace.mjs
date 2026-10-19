import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import ts from 'typescript';

export function loadTraceModule(file, dependencies = {}) {
  const exports = {}, code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected ${file} dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
export const traceProtocol = loadTraceModule('lib/app-local-command-trace-protocol.ts');
export const boundedTraceRead = loadTraceModule('lib/bounded-get.ts');
export const actualCommandTrace = loadTraceModule('lib/app-local-command-trace.ts', {
  'server-only': {}, 'node:async_hooks': { AsyncLocalStorage }, 'node:crypto': crypto,
  './bounded-get': boundedTraceRead, './app-local-command-trace-protocol': traceProtocol,
  './app-local-command-policy.json': JSON.parse(readFileSync('lib/app-local-command-policy.json', 'utf8')),
  './app-local-command-trace-names.generated.json': JSON.parse(readFileSync('lib/app-local-command-trace-names.generated.json', 'utf8')),
});
export class TraceFixtureAuthAvailabilityError extends Error {
  name = 'AuthAvailabilityError'; status = 503;
}
export function commandTraceRouteDependencies(options = {}) {
  return {
    '@/lib/app-local-command-trace': { ...actualCommandTrace, createAppLocalCommandTrace: headers => actualCommandTrace.createAppLocalCommandTrace(headers, { log: () => {}, ...options }) },
    '@/lib/supabase/auth-rest': { AuthAvailabilityError: TraceFixtureAuthAvailabilityError },
  };
}
