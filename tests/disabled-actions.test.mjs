import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

test("disabled product actions always declare a reason", () => {
  const tags = new Set([
    "Button",
    "HoldActionButton",
    "ConnectionTestButton",
    "ContextMenuItem",
    "DropdownMenuItem",
    "DropdownMenuSubTrigger",
    "DropdownMenuCheckboxItem",
    "button",
    "a",
  ])
  const missing = []
  function visitDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== "react-bits") visitDirectory(file)
        continue
      }
      if (!file.endsWith(".tsx")) continue
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      function visit(node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          if (tags.has(node.tagName.getText(source))) {
            const attributes = node.attributes.properties.filter(
              ts.isJsxAttribute
            )
            const disabled = attributes.some((attribute) =>
              ["disabled", "aria-disabled"].includes(
                attribute.name.getText(source)
              )
            )
            const reason = attributes.find((attribute) =>
              ["disabledReason", "data-disabled-reason"].includes(
                attribute.name.getText(source)
              )
            )
            if (
              disabled &&
              (!reason?.initializer ||
                (ts.isStringLiteral(reason.initializer) &&
                  !reason.initializer.text.trim()))
            ) {
              missing.push(
                `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
              )
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  visitDirectory("components")
  visitDirectory("app")
  assert.deepEqual(
    missing,
    [],
    `Disabled actions need an explanation: ${missing.join(", ")}`
  )
})
