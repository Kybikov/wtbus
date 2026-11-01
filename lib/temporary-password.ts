const alphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"

export function generateTemporaryPassword(): string {
  const limit = 256 - (256 % alphabet.length)
  let value = ""
  while (value.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit) value += alphabet[byte % alphabet.length]
      if (value.length === 20) break
    }
  }
  // Regenerate rather than weakening the random choice to force a character.
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)
    ? value
    : generateTemporaryPassword()
}
