import type { AppData } from '../domain/types'

export interface Storage {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  clear(): Promise<void>
}
