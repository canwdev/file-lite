export interface IpSelectorParams {
  ips: string[]
  port: number
  protocol: 'http:' | 'https:'
  ticket: string
}

const TICKET_LENGTH = 8

function isIPv6(ip: string) {
  return ip.includes(':')
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4)
    base64 += '='

  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

function stringifyIpv6(bytes: number[]): string {
  const view = new DataView(new Uint8Array(bytes).buffer)
  const sections: string[] = []
  for (let i = 0; i < 8; i++) {
    sections.push(view.getUint16(i * 2).toString(16))
  }

  let bestStart = -1
  let bestLen = 0
  let i = 0
  while (i < 8) {
    if (sections[i] !== '0') {
      i++
      continue
    }
    let j = i
    while (j < 8 && sections[j] === '0')
      j++
    const len = j - i
    if (len > bestLen) {
      bestLen = len
      bestStart = i
    }
    i = j
  }

  if (bestLen > 1) {
    const left = sections.slice(0, bestStart)
    const right = sections.slice(bestStart + bestLen)
    if (left.length === 0 && right.length === 0)
      return '::'
    if (left.length === 0)
      return `::${right.join(':')}`
    if (right.length === 0)
      return `${left.join(':')}::`
    return `${left.join(':')}::${right.join(':')}`
  }

  return sections.join(':')
}

export function formatHostForUrl(ip: string): string {
  return isIPv6(ip) ? `[${ip}]` : ip
}

export function decodeIpSelectorParams(encoded: string): IpSelectorParams {
  const uint8 = base64UrlToBytes(encoded)
  let offset = 0

  const protocol = uint8[offset++] === 1 ? 'https:' : 'http:'
  const port = (uint8[offset++]! << 8) | uint8[offset++]!

  let ticket = ''
  for (let i = 0; i < TICKET_LENGTH; i++) {
    ticket += String.fromCharCode(uint8[offset++]!)
  }
  ticket = ticket.trimEnd()

  const ipCount = uint8[offset++]!
  const ips: string[] = []

  for (let i = 0; i < ipCount; i++) {
    const type = uint8[offset++]!
    if (type === 4) {
      ips.push([
        uint8[offset++]!,
        uint8[offset++]!,
        uint8[offset++]!,
        uint8[offset++]!,
      ].join('.'))
    }
    else if (type === 6) {
      const ipv6Bytes: number[] = []
      for (let j = 0; j < 16; j++) {
        ipv6Bytes.push(uint8[offset++]!)
      }
      ips.push(stringifyIpv6(ipv6Bytes))
    }
  }

  return { ips, port, protocol, ticket }
}
