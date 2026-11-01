export function uiErrorMessage(message: string) {
  if (
    /Unexpected token|not valid JSON|JSON\.parse|Unexpected end of JSON|<!doctype|^\s*<html/i.test(
      message
    )
  )
    return "Не удалось загрузить данные. Повторите попытку."
  if (/Failed to fetch|NetworkError|Load failed/i.test(message))
    return "Проверьте соединение и повторите попытку."
  return message
}
