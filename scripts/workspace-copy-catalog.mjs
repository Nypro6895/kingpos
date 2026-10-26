import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { transformSync } from 'esbuild';

export const sections = ['staff', 'payroll', 'bookings', 'services', 'reports', 'pos', 'pos-tickets', 'customers', 'salon-settings', 'salon-profile', 'more', 'settings', 'account', 'campaigns', 'notifications', 'market', 'support', 'my-place', 'booking-setup', 'roles', 'permissions', 'salons', 'businesses', 'ownership'];
export function workspaceFiles() {
  const files = new Set();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) files.add(file);
    }
  }
  for (const section of sections) { walk(`app/${section}`); walk(`app/(app)/${section}`); }
  for (const file of ['app/navigation-shell.tsx', 'app/role-navigation.ts', 'app/salon-switcher.tsx', 'app/quick-workspace-panel.tsx', 'app/(app)/layout.tsx']) if (fs.existsSync(file)) files.add(file);
  // Include reusable UI imported by these screens. Server data modules are audited
  // separately for user-facing errors, without rewriting identifiers or enum values.
  const queue = [...files];
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index], source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1];
      const root = specifier.startsWith('@/') ? specifier.slice(2) : specifier.startsWith('.') ? path.posix.normalize(`${path.posix.dirname(file)}/${specifier}`) : null;
      if (!root || !(root.startsWith('components/') || root.startsWith('app/'))) continue;
      const dependency = [`${root}.tsx`, `${root}.ts`, `${root}/index.tsx`].find(candidate => fs.existsSync(candidate));
      if (dependency && !files.has(dependency) && !dependency.includes('workspace-language')) { files.add(dependency); queue.push(dependency); }
    }
  }
  return [...files].sort();
}
export function loadDictionary() {
  const compiled = transformSync(fs.readFileSync('lib/vietnamese-dictionary.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const dictionaryModule = { exports: {} }; new Function('module', 'exports', 'require', compiled)(dictionaryModule, dictionaryModule.exports, specifier => JSON.parse(fs.readFileSync(specifier.replace('@/', ''), 'utf8')));
  return dictionaryModule.exports.VIETNAMESE_UI;
}
const uiProperties = /^(?:title|description|label|placeholder|aria-label|alt|hint|subtitle|message|error|successMessage|confirmMessage|emptyMessage|loadingLabel|submitLabel|buttonLabel|pendingLabel|idleLabel|emptyLabel|heading|eyebrow|notice|caption|detail|summary|text|children)$/;
export function englishCopy(value) {
  return !/^[a-z]+[A-Z][A-Za-z]*$/.test(value) && !/^(?:numeric|en-US|eventType|source|UTC|2-digit|short|error|kind|notice|NEXT_|RPC|Supabase|Bearer \{0\}|Basic \{0\}|booking-\{0\}|staff-booking-settings-message.*)$/.test(value) && !/(?:border-|bg-|text-|rounded-|whitespace-|mt-2 grid)/.test(value) && /[A-Za-z]{2}/.test(value) && !/[\u00c0-\u024f\u1e00-\u1eff]/.test(value) && !/^(?:https?:|\/|@|data-|[A-Za-z0-9]+[_:/][A-Za-z0-9_:/. -]+$)/.test(value) && !value.includes('className');
}
export function copyOccurrences(file) {
  const source = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS), copies = [];
  function add(value, node, kind) { const normalized = value.trim().replace(/\s+/g, ' '); if (englishCopy(normalized)) copies.push({ text: normalized, file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind }); }
  function helperCopy(node) {
    for(let p=node.parent;p;p=p.parent){
      if(ts.isVariableDeclaration(p)&& /(?:LABELS|labels|statusLabels|messages|dayNames|monthNames|message|notice|error|Label|Title|Description|Message|Error)$/.test(p.name.getText(ast)))return true;
      if(ts.isFunctionDeclaration(p)&&p.name&& /(?:Label|Title|Message|Text|relativeTime|formatDuration|formatItemCount|formatPayoutMethod|formatYesNo|formatOnOff)$/.test(p.name.text))return true;
    }return false;
  }
  function visit(node) {
    if(helperCopy(node) && (ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isCaseClause(node.parent) && !(ts.isBinaryExpression(node.parent)&&node.parent.operatorToken.kind!==ts.SyntaxKind.PlusToken)) add(node.text,node,'helper');
    if(helperCopy(node)&&ts.isTemplateExpression(node)) add(node.head.text+node.templateSpans.map((span,index)=>'{'+index+'}'+span.literal.text).join(''),node,'template');
    if (ts.isTemplateExpression(node)) {
      let ancestor = node.parent;
      while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isJsxAttribute(ancestor) && !ts.isPropertyAssignment(ancestor) && !ts.isCallExpression(ancestor) && !ts.isNewExpression(ancestor) && !ts.isStatement(ancestor)) ancestor = ancestor.parent;
      const visible = ancestor && (ts.isJsxExpression(ancestor) && (!ts.isJsxAttribute(ancestor.parent) || uiProperties.test(ancestor.parent.name.getText(ast))) || ts.isPropertyAssignment(ancestor) && uiProperties.test(ancestor.name.getText(ast).replace(/["']/g, '')) || ts.isNewExpression(ancestor) && ancestor.expression.getText(ast) === 'Error' || ts.isCallExpression(ancestor) && /(?:set.*(?:Error|Message|Notice|Status)|alert|confirm|prompt|toast)/i.test(ancestor.expression.getText(ast)));
      if (visible) add(node.head.text + node.templateSpans.map((span, index) => `{${index}}` + span.literal.text).join(''), node, 'template');
    }
    if (ts.isJsxText(node)) add(node.text, node, 'text');
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if(ts.isArrayLiteralExpression(parent) && /[A-Z]|\s/.test(node.text)) { let outer=parent.parent;while(outer&&!ts.isJsxExpression(outer)&&!ts.isStatement(outer))outer=outer.parent;if(outer&&ts.isJsxExpression(outer)&&!ts.isJsxAttribute(outer.parent))add(node.text,node,'list'); }
      if (ts.isJsxAttribute(parent) && uiProperties.test(parent.name.getText(ast))) add(node.text, node, 'attribute');
      else if (ts.isPropertyAssignment(parent) && uiProperties.test(parent.name.getText(ast).replace(/["']/g, ''))) add(node.text, node, 'property');
      else if (ts.isNewExpression(parent) && parent.expression.getText(ast) === 'Error') add(node.text, node, 'error');
      else {
        let ancestor = parent;
        while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isJsxAttribute(ancestor) && !ts.isJsxElement(ancestor) && !ts.isJsxSelfClosingElement(ancestor) && !ts.isCallExpression(ancestor) && !ts.isPropertyAssignment(ancestor) && !ts.isStatement(ancestor)) ancestor = ancestor.parent;
        if (ancestor && ts.isJsxExpression(ancestor) && (!ts.isJsxAttribute(ancestor.parent) || uiProperties.test(ancestor.parent.name.getText(ast)))) {
          let cursor = parent, compared = false;
          while (cursor && cursor !== ancestor) { if (ts.isBinaryExpression(cursor) && cursor.operatorToken.kind !== ts.SyntaxKind.PlusToken) compared = true; cursor = cursor.parent; }
          if (!compared) add(node.text, node, 'expression');
        }
        if (ancestor && ts.isCallExpression(ancestor) && /(?:set.*(?:Error|Message|Notice|Status)|alert|confirm|prompt|toast)/i.test(ancestor.expression.getText(ast))) add(node.text, node, 'notice');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return copies;
}
if (process.argv[1]?.endsWith('workspace-copy-catalog.mjs')) {
  const dictionary = loadDictionary(), files = workspaceFiles();
  const occurrences = files.flatMap(copyOccurrences);
  function backend(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) backend(file);
      else if (file.endsWith('.ts')) occurrences.push(...copyOccurrences(file).filter(item => ['error', 'notice', 'template', 'property'].includes(item.kind)));
      else if (file.endsWith('.sql')) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/raise\s+exception\s+'((?:[^']|'')+)'/gi)) {
          const text = match[1].replace(/''/g, "'");
          if (englishCopy(text)) occurrences.push({ text, file, line: source.slice(0, match.index).split('\n').length, kind: 'database-error' });
        }
      }
    }
  }
  backend('lib'); backend('supabase/migrations');
  const missing = new Map();
  for (const occurrence of occurrences) if (!dictionary[occurrence.text]) {
    const previous = missing.get(occurrence.text);
    if (previous) previous.count++;
    else missing.set(occurrence.text, { ...occurrence, count: 1 });
  }
  const catalog = [...missing.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  fs.mkdirSync('artifacts/vietnamese-localization', { recursive: true });
  fs.writeFileSync('artifacts/vietnamese-localization/missing-copy.json', JSON.stringify(catalog, null, 2));
  console.log(JSON.stringify({ files: files.length, occurrences: occurrences.length, missing: catalog.length }));
  console.log(catalog.slice(0, 100).map(item => `${item.count}\t${item.text}`).join('\n'));
}
