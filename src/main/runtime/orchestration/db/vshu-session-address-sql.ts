import { VSHU_SESSION_ADDRESS_PREFIX } from '../../../../shared/agent-session/identity/vshu-session-address-prefix'

/** Format bare ids as session addresses (NULL stays NULL); never strip addresses and risk matching handles or Runs. */
export function vshuSessionAddressSql(vshuSessionIdSql: string): string {
  return `('${VSHU_SESSION_ADDRESS_PREFIX}' || ${vshuSessionIdSql})`
}

/** The bare id a session address names, NULL for anything else; comparing ids lets the id index serve. */
export function vshuSessionIdOfAddressSql(addressSql: string): string {
  return `(CASE WHEN substr(${addressSql}, 1, ${VSHU_SESSION_ADDRESS_PREFIX.length}) = '${VSHU_SESSION_ADDRESS_PREFIX}'
    THEN substr(${addressSql}, ${VSHU_SESSION_ADDRESS_PREFIX.length + 1}) END)`
}
