# Restrict clients with allowedCIDRs

[中文](./zh-CN/ip-allowlist.md) | English

File Lite (Go backend) limits which client IP ranges may connect through the `allowedCIDRs` field of `config.json` in the data directory. The check runs before static files, the API and WebSocket connections.

## Semantics

| config.json | Behavior |
| --- | --- |
| `"allowedCIDRs": null` (the default, including what `--create-config` writes) | No restriction; every IP is allowed |
| `"allowedCIDRs": []` | Deny everyone (fail-closed) |
| `"allowedCIDRs": ["192.168.0.0/16", …]` | Allow only clients that match the list; everyone else gets 403 |

An omitted field and an explicit empty array are different on purpose. An empty list fails closed instead of silently leaving the server open: clearing it means nobody may connect.

## Syntax

- CIDR: `192.168.0.0/16`, `10.0.0.0/8`, `fe80::/10`
- A single IP: `192.168.1.10` (same as `/32`), `::1` (same as `/128`)
- IPv4 and IPv6 may be mixed. Duplicates are removed.

LAN and localhost only:

```json
{
  "allowedCIDRs": ["192.168.0.0/16", "10.0.0.0/8", "127.0.0.0/8", "::1/128"]
}
```

IPv4 only (this also blocks every IPv6 connection):

```json
{
  "allowedCIDRs": ["0.0.0.0/0"]
}
```

## Applying it and checking it

- Restart the server after a change. An illegal entry in `allowedCIDRs` refuses startup and the bad entry is printed.
- Startup prints the policy that is in effect, so you can see which of the three cases you are in:

```
ip allowlist: off
ip allowlist: allow 192.168.0.0/16, 10.0.0.0/8
ip allowlist: deny all (allowedCIDRs is empty)
```

- A client that does not match gets `403 Forbidden`.

## Notes

- **The decision uses the direct TCP address** (`RemoteAddr`). **`X-Forwarded-For` and `X-Real-IP` are not used.** The client controls those headers, so trusting them would make the allowlist meaningless. If a reverse proxy sits in front of File Lite, every request looks like the proxy's IP and the allowlist either stops working or blocks the wrong clients. Filter IPs at the proxy in that case.
- This is application-level filtering, not a security boundary. To expose the server on the public internet, also use a firewall (nftables / ufw).
- The setting only decides whether a request may be opened. Login, `ticket` and rate limiting are unchanged.
