import { cleanCloudServiceOrigin } from '../../shared/network/cloud-service-url'

// The connector's canonical host. connector.vshu.dev still serves the same service, so released
// desktops that default to it keep working.
export const DEFAULT_CONNECTOR_ORIGIN = 'https://connector.vshu.dev'

export function resolveConnectorOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string {
  return cleanCloudServiceOrigin(env.VSHU_CONNECTOR_URL, !packaged) ?? DEFAULT_CONNECTOR_ORIGIN
}
