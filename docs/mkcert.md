# 使用 mkcert 生成并信任自签名证书

## 1. 安装 mkcert

- 下载最新版本 [Releases · FiloSottile/mkcert](https://github.com/FiloSottile/mkcert/releases)
- 把可执行文件放到 PATH 路径中

## 2. 创建并安装证书（Node.js 示例）

```bash
# 切换到 data 目录
cd data

# 创建证书，支持 *.app.local localhost、127.0.0.1、::1 等多个域名和IP地址
# 注意：如果使用其他IP地址，需要手动添加到下面
mkcert app.local "*.app.local" localhost 127.0.0.1 ::1

# 自动安装证书到系统
mkcert -install
```

Windows 检查证书是否安装：

- win+r 运行 `certmgr.msc`
- 在 `受信任的根证书颁发机构 > 证书` 下，可以找到 `mkcert` 开头的证书，说明安装成功

## 3. 后续步骤

编辑 `data/config.json` 新增或编辑 `sslKey` 和 `sslCert` 字段

```json
{
  "sslKey": "app.local+4-key.pem",
  "sslCert": "app.local+4.pem"
}
```

重启服务即可生效。

注意：

- 如果要在目标计算机上访问，参考 [Installing the CA on other systems](https://github.com/FiloSottile/mkcert?tab=readme-ov-file#installing-the-ca-on-other-systems)
  1. 在本机运行 `mkcert -CAROOT` 打开证书目录，获取 `rootCA.pem` 文件
  2. 在目标计算机运行 `mkcert -CAROOT` 打开证书目录
  3. 复制本机 `rootCA.pem` 文件到目标计算机的证书目录下
  4. 在目标计算机上运行 `mkcert -install`
- 请勿在生产环境中使用自签名证书
