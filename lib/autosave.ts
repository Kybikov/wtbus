// Serialize committed field changes. Never abort a write: aborting the browser
// request does not guarantee the server cancelled its transaction.
export function createAutosaveQueue<T extends object>(
  persist: (value: T) => Promise<T>
) {
  let saved: T | null = null
  let generation = 0
  let tail: Promise<unknown> = Promise.resolve()
  return {
    reset(value: T | null) {
      saved = value
      generation++
    },
    commit(patch: Partial<T>, write = persist): Promise<T | null> {
      const epoch = generation
      const task = tail
        .catch(() => undefined)
        .then(async () => {
          if (!saved || epoch !== generation) return null
          const next = { ...saved, ...patch }
          if (JSON.stringify(next) === JSON.stringify(saved)) return saved
          const result = await write(next)
          if (epoch === generation) saved = result
          return result
        })
      tail = task
      return task
    },
  }
}
