import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('the app route fallback renders one shared Lumi loading status', async () => {
  const result = await build({
    stdin: {
      contents: 'export { default } from "./app/(app)/loading.tsx";',
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{
      name: 'presentation-dependencies',
      setup(builder) {
        // Keep the actual route -> shared status -> Lumi mark component chain.
        // Translation state and CSS do not affect its indicator ownership.
        builder.onResolve({ filter: /workspace-language$/ }, () => ({ path: 'text', namespace: 'presentation' }));
        builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'styles', namespace: 'presentation' }));
        builder.onLoad({ filter: /.*/, namespace: 'presentation' }, args => ({
          contents: args.path === 'styles' ? 'export default {};' : 'export const WorkspaceText = ({ text }) => text;',
          loader: 'js',
        }));
      },
    }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, compiled, compiled.exports);
  const html = renderToStaticMarkup(React.createElement(compiled.exports.default));

  assert.equal((html.match(/data-lumi-loading-mark=/g) ?? []).length, 1, 'the route must not add another mark around the shared loader');
  assert.equal((html.match(/role="status"/g) ?? []).length, 1, 'announce a single waiting state');
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Getting things ready/);
});
