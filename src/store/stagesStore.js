import { load, save } from './storage'
import { DEFAULT_STAGES } from '../utils/constants'

const KEY = 'stages'

export function getStages() {
  return load(KEY, DEFAULT_STAGES)
}

export function saveStages(stages) {
  save(KEY, stages)
  return stages
}
