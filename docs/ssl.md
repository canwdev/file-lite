## 使用自签名证书启用 HTTPS

File Lite（Go 后端）通过数据目录下 `config.json` 的 `sslKey` 与 `sslCert` 字段开启 HTTPS。两个字段都非空时以 HTTPS 启动，否则以 HTTP 启动；路径相对于数据目录（默认 `<cwd>/file-lite/`，可用 `--data-dir` 或 `FILE_LITE_DATA_BASE_DIR` 修改）。

### 1. 生成自签名证书（已生成请跳过）

**方式一：首次创建配置时自动生成**（需要系统已安装 OpenSSL）

```bash
./file-lite-go --create-config --with-tls
```

它会在数据目录生成证书，并把 `sslKey` / `sslCert` 写入 `config.json`。

**方式二：使用 OpenSSL 手动生成**

```bash
# 切换到数据目录
cd file-lite

openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
```

> Windows 下可用 Git Bash 运行上述命令。需要先安装 Git for Windows。

这个命令会生成两个文件：

- **key.pem**: 私钥文件
- **cert.pem**: 证书文件

运行命令后，OpenSSL 会要求你提供一些信息，例如国家代码、州、城市、组织名称、组织单位名称、通用名称（域名）和电子邮件地址。这些信息可以根据你的需要填写。`Common Name (例如，服务器 FQDN 或您的名称) []:` 这一项很重要，通常情况下，你需要输入你的服务器的域名或 `localhost` 用于本地开发。

**方式三：使用 mkcert**（更便于在系统和浏览器中建立信任）

见 [使用 mkcert 生成并信任自签名证书](./mkcert.md)。

### 2. 在配置中启用

编辑 `file-lite/config.json`，新增或修改 `sslKey` 和 `sslCert`（相对数据目录的路径）：

```json
{
  "sslKey": "key.pem",
  "sslCert": "cert.pem"
}
```

### 3. 重启服务

重启后控制台会打印 `HTTPS enabled`，并使用 `https://` 链接。

### 4. 信任自签名证书（仅开发环境）

信任自签名证书的步骤取决于你的操作系统和浏览器。

**Windows:**

1.  双击 `cert.pem` 文件。
2.  选择“安装证书”。
3.  选择“本地计算机”并单击“下一步”。
4.  选择“将所有证书都放入下列存储”并单击“浏览”。
5.  选择“受信任的根证书颁发机构”并单击“确定”。
6.  单击“下一步”和“完成”。
7.  如果弹出安全警告，请单击“是”。

**macOS:**

1.  双击 `cert.pem` 文件。
2.  "钥匙串访问" 应用将打开。
3.  在“钥匙串”下拉菜单中，选择 "系统"。
4.  单击“添加”。
5.  找到你添加的证书 (通常显示为你的 Common Name)。
6.  双击证书。
7.  在“信任”部分，将“使用此证书时”更改为“始终信任”。
8.  输入你的管理员密码。

**Linux (Ubuntu):**

1.  将 `cert.pem` 文件复制到 `/usr/local/share/ca-certificates/` 目录：

    ```bash
    sudo cp cert.pem /usr/local/share/ca-certificates/my-app.crt
    ```

2.  更新证书信任存储：

    ```bash
    sudo update-ca-certificates
    ```

完成后重新启动浏览器，访问 `https://localhost:<port>` 就不会再看到安全警告。

### 注意事项

- **自签名证书不受信任**：浏览器会显示警告，需要手动信任后才能正常访问。
- **仅用于开发环境**：自签名证书不适合用于生产环境，生产环境应使用受信任的 CA 颁发的证书。
- **证书有效期**：生成时的 `-days 365` 指定了有效期，可按需调整。
- **安全性**：请妥善保管私钥（`key.pem`），不要泄露给任何人。
