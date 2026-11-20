import fs from 'node:fs';
import ts from 'typescript';
import { workspaceFiles, englishCopy } from './workspace-copy-catalog.mjs';

const uiAttributes = new Set(['title', 'description', 'label', 'placeholder', 'aria-label', 'alt', 'hint', 'subtitle', 'successMessage', 'confirmMessage', 'emptyMessage', 'loadingLabel', 'submitLabel', 'buttonLabel', 'heading', 'eyebrow', 'caption', 'detail', 'summary']);
const protectedData = /\b(?:customer|client|staffMember|professional|service|salon|business|user|profile|post|look|inspiration|comment|review|note|attachment)\??\.(?:name|title|description|text|message|displayName|body)\b/i;
const dynamicCopy = /(?:^|\.)(?:label|title|subtitle|heading|caption|hint|error|errorMessage|message|statusLabel|descriptionLabel|dateLabel|createdAtLabel|dayLabel|timeLabel|buttonLabel|emptyMessage|successMessage|notice|text)(?:\??\.|\s*\?\?|\s*\|\||$)|\b(?:format\w*(?:Date|Time)|\w*(?:Error|Message|Status|Label))\(/;
const stats = { files: 0, text: 0, attributes: 0, dynamic: 0, dialogs: 0, unsupported: [] };

for (const file of workspaceFiles().filter(file => file.endsWith('.tsx') && !file.includes('vietnamese-plugin-panel') && !file.includes('workspace-language'))) {
  let source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const client = ast.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client');
  const edits = [], functions = new Map(), imports = new Set(), replacedTags = new Set();
  function componentName(node) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    let parent = node.parent;
    while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    return '';
  }
  function translatorFor(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) && parent.body && ts.isBlock(parent.body) && /^[A-Z]/.test(componentName(parent))) {
        const async = parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
        if (!client && !async) return null;
        if (!functions.has(parent)) functions.set(parent, client ? 'client' : 'server');
        return '__vt';
      }
    }
    return null;
  }
  function add(start, end, text) { edits.push({ start, end, text }); }
  function hasRenderedLiteral(expression) {
    let result = false;
    function scan(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
      if (ts.isBinaryExpression(node) && ![ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return;
      if (ts.isConditionalExpression(node)) { scan(node.whenTrue); scan(node.whenFalse); return; }
      if (ts.isCallExpression(node)) return;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (englishCopy(node.text)) result = true; return; }
      if (ts.isTemplateExpression(node)) { if (englishCopy(node.head.text + node.templateSpans.map(span => span.literal.text).join(' '))) result = true; return; }
      ts.forEachChild(node, scan);
    }
    scan(expression);
    return result;
  }
  function fallbackElement(attribute) {
    const opening = attribute.parent.parent;
    if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) return false;
    const tag = opening.tagName.getText(ast);
    if (!/^[a-z]/.test(tag) || tag.includes('.')) return false;
    if (!replacedTags.has(opening)) {
      replacedTags.add(opening); imports.add('WorkspaceElement');
      add(opening.tagName.getStart(ast), opening.tagName.end, `WorkspaceElement as=${JSON.stringify(tag)}`);
      if (ts.isJsxOpeningElement(opening)) {
        const closing = opening.parent.closingElement;
        add(closing.tagName.getStart(ast), closing.tagName.end, 'WorkspaceElement');
      }
    }
    return true;
  }
  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = node.text.trim().replace(/\s+/g, ' ');
      if (englishCopy(text)) {
        imports.add('WorkspaceText');
        add(node.pos, node.end, node.text.match(/^\s*/)[0] + '<WorkspaceText text=' + JSON.stringify(text) + ' />' + node.text.match(/\s*$/)[0]);
        stats.text++;
      }
      return;
    }
    if (ts.isJsxAttribute(node) && uiAttributes.has(node.name.getText(ast)) && node.initializer) {
      const tag = node.parent.parent.tagName?.getText(ast);
      if (['WorkspaceText', 'WorkspaceElement'].includes(tag)) return;
      const initializer = node.initializer;
      const raw = ts.isStringLiteral(initializer) ? JSON.stringify(initializer.text) : ts.isJsxExpression(initializer) && initializer.expression ? initializer.expression.getText(ast) : null;
      if (raw && !raw.startsWith('__vt(') && !protectedData.test(raw)) {
        const translator = translatorFor(node);
        if (translator) { add(initializer.getStart(ast), initializer.end, `{${translator}(${raw})}`); stats.attributes++; return; }
        if (!fallbackElement(node)) stats.unsupported.push({ file, line: ast.getLineAndCharacterOfPosition(node.pos).line + 1, attribute: node.name.getText(ast) });
      }
    }
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const expression = node.expression, raw = expression.getText(ast);
      const parentTag = node.parent.openingElement?.tagName?.getText(ast);
      if (!['WorkspaceText', 'WorkspaceElement'].includes(parentTag) && !protectedData.test(raw) && !raw.startsWith('__vt(') && !/^<WorkspaceText/.test(raw) && (hasRenderedLiteral(expression) || dynamicCopy.test(raw))) {
        // Components, collection mapping and object-valued UI structures keep their
        // own rendering. Only scalar display slots are localized here.
        if (!/\.map\(|\.filter\(|=>|<\w/.test(raw)) {
          imports.add('WorkspaceText'); add(node.pos, node.end, `<WorkspaceText text={${raw}} />`); stats.dynamic++; return;
        }
      }
    }
    if (ts.isCallExpression(node) && /^(?:window\.)?(?:alert|confirm|prompt)$/.test(node.expression.getText(ast)) && node.arguments[0]) {
      const argument = node.arguments[0], raw = argument.getText(ast);
      if (!raw.startsWith('__vt(') && !raw.startsWith('workspaceDialogText(')) {
        const translator = translatorFor(node);
        if (translator) add(argument.getStart(ast), argument.end, `__vt(${raw})`);
        else if (client) { imports.add('workspaceDialogText'); add(argument.getStart(ast), argument.end, `workspaceDialogText(${raw})`); }
        stats.dialogs++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [node, kind] of functions) {
    if (/\b(?:const|let)\s+__vt\b/.test(node.body.getText(ast))) continue;
    const portable = file.includes('/pos/portable/') ? 'true' : '';
    add(node.body.getStart(ast) + 1, node.body.getStart(ast) + 1, `\n  const __vt = ${kind === 'client' ? 'useWorkspaceTranslation()' : `await getWorkspaceTranslation(${portable})`};\n`);
    imports.add(kind === 'client' ? 'useWorkspaceTranslation' : 'getWorkspaceTranslation');
  }
  if (!edits.length) continue;
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  const serverImport = imports.delete('getWorkspaceTranslation');
  if (imports.size) {
    const existing = /import\s*\{([^}]+)\}\s*from\s*["']@\/components\/workspace-language["'];?/;
    const match = existing.exec(source);
    if (match) { const names = new Set([...match[1].split(',').map(name => name.trim()).filter(Boolean), ...imports]); source = source.replace(existing, `import { ${[...names].join(', ')} } from "@/components/workspace-language";`); }
    else { const directive = /("use client"|'use client');\s*/.exec(source); const offset = directive ? directive.index + directive[0].length : 0; source = source.slice(0, offset) + `import { ${[...imports].join(', ')} } from "@/components/workspace-language";\n` + source.slice(offset); }
  }
  if (serverImport && !source.includes('import { getWorkspaceTranslation }')) source = 'import { getWorkspaceTranslation } from "@/lib/workspace-language-server";\n' + source;
  fs.writeFileSync(file, source); stats.files++;
}
fs.writeFileSync('artifacts/vietnamese-localization/wiring-report.json', JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
