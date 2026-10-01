import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const TABLE_COLUMNS = {
  pos_financial_adjustments: new Set([
    "actual_total_delta",
    "business_date",
    "cash_delta",
    "correction_request_id",
    "created_at",
    "created_by",
    "credit_card_delta",
    "discount_delta",
    "expected_total_delta",
    "gift_card_delta",
    "id",
    "note",
    "other_delta",
    "salon_id",
    "service_delta",
    "staff_id",
    "target_id",
    "target_type",
    "ticket_id",
    "tip_delta",
    "turn_delta",
  ]),
  pos_financial_correction_requests: new Set([
    "admin_note",
    "applied_at",
    "approved_at",
    "approved_by",
    "business_date",
    "correction_type",
    "created_at",
    "id",
    "money_delta",
    "old_value_json",
    "reason",
    "rejected_at",
    "rejected_by",
    "requested_at",
    "requested_by",
    "requested_value_json",
    "salon_id",
    "status",
    "target_id",
    "target_type",
    "ticket_id",
    "updated_at",
  ]),
  pos_ticket_adjustments: new Set([
    "action",
    "after_snapshot",
    "before_snapshot",
    "created_at",
    "created_by",
    "id",
    "reason",
    "replacement_ticket_item_id",
    "salon_id",
    "ticket_id",
  ]),
};

function listSourceFiles() {
  const result = spawnSync("rg", ["--files", "app", "lib"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout
    .split(/\r?\n/)
    .filter((file) => /\.(ts|tsx)$/.test(file));
}

function tableFromExpression(expression) {
  if (!expression) {
    return null;
  }

  if (ts.isCallExpression(expression)) {
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "from"
    ) {
      const arg = expression.arguments[0];
      return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
    }

    return ts.isPropertyAccessExpression(expression.expression)
      ? tableFromExpression(expression.expression.expression)
      : tableFromExpression(expression.expression);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return tableFromExpression(expression.expression);
  }

  return null;
}

function propertyName(name) {
  if (!name) {
    return null;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function collectPayloadKeys(node, output = new Set()) {
  if (!node) {
    return output;
  }

  if (ts.isParenthesizedExpression(node)) {
    return collectPayloadKeys(node.expression, output);
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property)
      ) {
        const name = propertyName(property.name);
        if (name) {
          output.add(name);
        }
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      collectPayloadKeys(element, output);
    }
  } else if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map"
  ) {
    const callback = node.arguments[0];
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      collectPayloadKeys(callback.body, output);
    }
  }

  return output;
}

test("financial Supabase writes do not send columns missing from schema", () => {
  const violations = [];

  for (const file of listSourceFiles()) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const table = tableFromExpression(node.expression.expression);
        const columns = table ? TABLE_COLUMNS[table] : null;

        if (columns && ["insert", "update", "upsert"].includes(method)) {
          for (const key of collectPayloadKeys(node.arguments[0])) {
            if (!columns.has(key)) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile),
              );
              violations.push(`${file}:${line + 1}:${character + 1} ${table}.${key}`);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(violations, []);
});
