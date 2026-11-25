import { legacySpellings } from '../branding/legacy-brand-names'

export const VSHU_YAML_FILE_NAME = 'vshu.yaml'

/** Repos keep their pre-rebrand config file, so read it when vshu.yaml is absent; newest brand first. */
export const VSHU_YAML_FILE_NAMES: readonly string[] = [
  VSHU_YAML_FILE_NAME,
  ...legacySpellings(VSHU_YAML_FILE_NAME)
]

/** The first config file name that exists, or vshu.yaml when none does. */
export function resolveVshuYamlFileName(exists: (fileName: string) => boolean): string {
  return VSHU_YAML_FILE_NAMES.find((fileName) => exists(fileName)) ?? VSHU_YAML_FILE_NAME
}
