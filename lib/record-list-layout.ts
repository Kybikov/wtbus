// At most two values per column; keep a title and its subtitle together.
export function recordListColumns(fields: string[]): string[][] {
  if (!fields.length) return []
  const result = [fields.slice(0, 2)]
  const rest = fields.slice(2)
  if (rest.length === 2) return [...result, [rest[0]], [rest[1]]]
  for (let index = 0; index < rest.length; index += 2)
    result.push(rest.slice(index, index + 2))
  return result
}
