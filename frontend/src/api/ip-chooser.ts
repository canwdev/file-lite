import service from '@/utils/service'

const baseURL = `/api/files`

/** Response of the IP chooser: ready-to-use login URLs plus the ticket expiry. */
export interface IIpChooserInfo {
  urls: string[]
  expiresAt: string
}

/**
 * Mint a fresh short-lived ticket and return one login URL per local address.
 *
 * The backend keeps a single global ticket, so every call invalidates the URLs
 * a previous call returned.
 */
export async function getIpChooserInfo(): Promise<IIpChooserInfo> {
  return (await service.post(`${baseURL}/ip-chooser`)) as unknown as IIpChooserInfo
}
