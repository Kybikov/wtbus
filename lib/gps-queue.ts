export type GPSPoint = {
  clientPointId: string
  membershipId: string
  vehicleId: string
  tripId: string
  latitude: number
  longitude: number
  accuracyMeters: number
  recordedAt: string
}

export type StoredGPSPoint = GPSPoint & { scope: string }
export const GPS_QUEUE_LIMIT = 5000
export const GPS_INTERVAL_MS = 25_000
export const GPS_MAX_AGE_MS = 48 * 60 * 60 * 1000

export interface GPSStore {
  list(scope: string): Promise<StoredGPSPoint[]>
  add(point: StoredGPSPoint): Promise<void>
  remove(id: string): Promise<void>
}

export class GPSDeliveryError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Delete acknowledged IDs only. A point captured during a flush must survive it.
export class GPSQueue {
  private running: Promise<void> | null = null
  private retryAt = 0
  private failures = 0
  private store: GPSStore
  private scope: string
  private send: (point: GPSPoint) => Promise<void>
  private now: () => number
  constructor(
    store: GPSStore,
    scope: string,
    send: (point: GPSPoint) => Promise<void>,
    now: () => number = Date.now
  ) {
    this.store = store
    this.scope = scope
    this.send = send
    this.now = now
  }

  flush(onRejected: (point: GPSPoint) => void = () => {}): Promise<void> {
    if (this.running) return this.running
    if (this.now() < this.retryAt) return Promise.resolve()
    this.running = this.deliver(onRejected).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async deliver(onRejected: (point: GPSPoint) => void) {
    const points = (await this.store.list(this.scope)).slice(0, 50)
    for (const point of points) {
      if (this.now() - Date.parse(point.recordedAt) > GPS_MAX_AGE_MS) {
        await this.store.remove(point.clientPointId)
        onRejected(point)
        continue
      }
      try {
        // The storage namespace never leaves the browser.
        const { scope: _scope, ...payload } = point
        void _scope
        await this.send(payload)
        await this.store.remove(point.clientPointId)
        this.failures = 0
        this.retryAt = 0
      } catch (error) {
        if (
          error instanceof GPSDeliveryError &&
          [400, 404, 409, 422].includes(error.status)
        ) {
          await this.store.remove(point.clientPointId)
          onRejected(point)
          continue
        }
        this.failures += 1
        this.retryAt =
          this.now() +
          Math.min(60_000, 2000 * 2 ** Math.min(this.failures - 1, 5))
        // Authentication errors retain data for the same membership after re-login.
        throw error
      }
    }
  }
}

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vivat-driver-gps", 1)
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("points", { keyPath: "clientPointId" })
          .createIndex("scope", "scope")
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          database = undefined
        }
        resolve(request.result)
      }
      request.onerror = () => {
        database = undefined
        reject(request.error)
      }
      request.onblocked = () => {
        database = undefined
        reject(
          new Error("Хранилище GPS занято. Закройте другие окна приложения.")
        )
      }
    })
  }
  return database
}

export const indexedGPSStore: GPSStore = {
  async list(scope) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("points")
        .objectStore("points")
        .index("scope")
        .getAll(scope)
      request.onsuccess = () =>
        resolve(
          (request.result as StoredGPSPoint[]).sort((a, b) =>
            a.recordedAt.localeCompare(b.recordedAt)
          )
        )
      request.onerror = () => reject(request.error)
    })
  },
  async add(point) {
    const db = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("points", "readwrite")
      const store = transaction.objectStore("points")
      const count = store.index("scope").count(point.scope)
      let full = false
      count.onsuccess = () => {
        if (count.result >= GPS_QUEUE_LIMIT) {
          full = true
          transaction.abort()
        } else store.add(point)
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(
          new Error(
            full
              ? "Очередь GPS заполнена. Восстановите связь для отправки точек."
              : "Не удалось сохранить GPS на телефоне. Проверьте свободное место и разрешения браузера."
          )
        )
      transaction.onerror = () => reject(transaction.error)
    })
  },
  async remove(id) {
    const db = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("points", "readwrite")
      transaction.objectStore("points").delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  },
}
