// Imported first by each renderer entry so pre-rebrand keys are copied before any module reads one.
import { runLegacyBrandLocalStorageMigration } from './legacy-brand-local-storage'

runLegacyBrandLocalStorageMigration()
