# 用 allowedCIDRs 限制可访问的 IP 段

File Lite（Go 后端）通过数据目录下 `config.json` 的 `allowedCIDRs` 字段限制允许访问的客户端 IP 段。它在静态资源、API 和 WebSocket 连接之前统一生效。

## 语义

| config.json | 行为 |
| --- | --- |
| `"allowedCIDRs": null`（缺省值，`--create-config` 生成的默认值） | 不限制，放行所有 IP |
| `"allowedCIDRs": []` | 全部拒绝（fail-closed） |
| `"allowedCIDRs": ["192.168.0.0/16", …]` | 仅放行命中列表的客户端，其余返回 403 |

区分「字段缺省」和「显式空数组」是有意为之：漏配或旧配置不会静默变成裸奔，而显式清空则表示谁都不许访问。

## 写法

- CIDR：`192.168.0.0/16`、`10.0.0.0/8`、`fe80::/10`
- 单个 IP：`192.168.1.10`（等价 `/32`）、`::1`（等价 `/128`）
- IPv4 与 IPv6 可混写；重复项会自动去重。

只允许局域网和本机：

```json
{
  "allowedCIDRs": ["192.168.0.0/16", "10.0.0.0/8", "127.0.0.0/8", "::1/128"]
}
```

只允许 IPv4（顺带阻止所有 IPv6 连接）：

```json
{
  "allowedCIDRs": ["0.0.0.0/0"]
}
```

## 生效与排查

- 修改后重启服务生效；`allowedCIDRs` 中有非法条目时服务会拒绝启动，并打印出错的条目。
- 启动时会打印生效策略，便于确认当前处于哪一档：

```
ip allowlist: off
ip allowlist: allow 192.168.0.0/16, 10.0.0.0/8
ip allowlist: deny all (allowedCIDRs is empty)
```

- 未命中时返回 `403 Forbidden`。

## 注意事项

- **判定依据是 TCP 直连地址**（`RemoteAddr`），**不使用** `X-Forwarded-For` / `X-Real-IP`。这些请求头由客户端控制，若用于白名单等于没有白名单。因此如果 File Lite 前面有反向代理，所有请求都会表现为代理的 IP，白名单会失效或误伤——这种情况请在代理层做 IP 过滤。
- 这是应用层过滤，不是安全边界；要暴露到公网，请配合防火墙（nftables / ufw）使用。
- 该配置只决定能否建立请求，不影响登录、`ticket`、限流等既有机制。
