import fs from 'node:fs';
import ts from 'typescript';
import * as esbuild from 'esbuild';
const compiled = esbuild.transformSync(fs.readFileSync('lib/vietnamese-dictionary.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const moduleCopy = { exports: {} };
new Function('module', 'exports', 'require', compiled)(moduleCopy, moduleCopy.exports, specifier => JSON.parse(fs.readFileSync(specifier.replace('@/', ''), 'utf8')));
const dictionary = moduleCopy.exports.VIETNAMESE_UI;
const sections = ['staff', 'payroll', 'bookings', 'services', 'reports', 'pos', 'pos-tickets', 'customers', 'salon-settings', 'salon-profile', 'more'];
const roots = sections.flatMap(section => ['app/' + section, 'app/(app)/' + section]);
roots.push('app/market');
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.tsx')) files.push(file);
  }
}
roots.forEach(walk);
files.push('app/navigation-shell.tsx');
let count = 0, labels = 0;
for (const file of files) {
  if (file.includes('vietnamese-plugin-panel')) continue;
  let source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(node) {
    // Literal text inside a rendered expression also belongs to the UI dictionary.
    if (ts.isStringLiteral(node) && dictionary[node.text]) {
      let parent = node.parent;
      while (parent && !ts.isJsxExpression(parent) && !ts.isCallExpression(parent) && !ts.isJsxAttribute(parent) && !ts.isPropertyAssignment(parent)) parent = parent.parent;
      if (parent && ts.isJsxExpression(parent) && !ts.isJsxAttribute(parent.parent) && (node.parent === parent || ts.isConditionalExpression(node.parent))) {
        edits.push({ start: node.getStart(ast), end: node.end, text: '<WorkspaceText text=' + JSON.stringify(node.text) + ' />' });
      }
    }
    if (ts.isJsxText(node)) {
      const text = node.text.trim().replace(/\s+/g, ' ');
      if (dictionary[text]) {
        const leading = node.text.match(/^\s*/)[0], trailing = node.text.match(/\s*$/)[0];
        edits.push({ start: node.pos, end: node.end, text: leading + '<WorkspaceText text=' + JSON.stringify(text) + ' />' + trailing });
      }
    }
    if (file === 'app/navigation-shell.tsx' && ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'label') {
      edits.push({ start: node.pos, end: node.end, text: '<WorkspaceText text={' + node.expression.getText(ast) + '} />' });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!edits.length) continue;
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  if (!source.includes('import { WorkspaceText }')) {
    const directive = /^("use client"|'use client');\s*/.exec(source);
    const offset = directive ? directive[0].length : 0;
    source = source.slice(0, offset) + 'import { WorkspaceText } from "@/components/workspace-language";\n' + source.slice(offset);
  }
  fs.writeFileSync(file, source);
  count++; labels += edits.length;
}
console.log(`Localized ${labels} labels across ${count} files.`);
