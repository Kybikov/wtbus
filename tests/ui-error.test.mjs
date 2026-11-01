import test from "node:test"
import assert from "node:assert/strict"
import { uiErrorMessage } from "../lib/ui-error.ts"

test("HTML and malformed JSON errors become a useful retry message", () => {
  for (const message of [
    `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    "Unexpected end of JSON input",
    "JSON.parse: unexpected character",
    "<!doctype html><html>Not Found</html>",
  ]) {
    assert.equal(
      uiErrorMessage(message),
      "Не удалось загрузить данные. Повторите попытку."
    )
  }
})

test("network failures explain how to retry", () => {
  for (const message of ["Failed to fetch", "NetworkError", "Load failed"])
    assert.equal(
      uiErrorMessage(message),
      "Проверьте соединение и повторите попытку."
    )
})

test("business restrictions and write failures retain their actual reason", () => {
  for (const message of [
    "Недостаточно мест в рейсе.",
    "Тестовая ошибка сохранения",
    "Сначала подтвердите оплату.",
  ])
    assert.equal(uiErrorMessage(message), message)
})
