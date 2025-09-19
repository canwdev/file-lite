## 使用 Express 启动 HTTPS 服务并使用自签名证书

以下步骤演示了如何在 Express 应用中使用自签名证书启动 HTTPS 服务：

**1. 生成自签名证书**(已生成请跳过)

你可以使用 OpenSSL 来生成自签名证书。 如果你没有安装 OpenSSL，请先安装它。

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
```

> Windows 下可用 Git Bash 运行上述命令生成证书。需要先安装 Git for Windows。

这个命令会生成两个文件：

- **key.pem**: 私钥文件
- **cert.pem**: 证书文件

运行命令后，OpenSSL会要求你提供一些信息，例如国家代码、州、城市、组织名称、组织单位名称、通用名称（域名）和电子邮件地址。 这些信息可以根据你的需要填写。 `Common Name (例如，服务器 FQDN 或您的名称) []:` 这一项很重要，通常情况下，你需要输入你的服务器的域名或 `localhost` 用于本地开发。

**2. 安装 Express 和 HTTPS 模块**

```bash
npm install express https
```

**3. 创建 Express 应用并配置 HTTPS**

创建一个 `app.js` 文件 (或其他你喜欢的名字) 并添加以下代码：

```javascript
const express = require('express')
const https = require('https')
const fs = require('fs')

const app = express()

// 读取证书和私钥
const privateKey = fs.readFileSync('key.pem', 'utf8')
const certificate = fs.readFileSync('cert.pem', 'utf8')

const credentials = {
  key: privateKey,
  cert: certificate,
}

// 定义一个简单的路由
app.get('/', (req, res) => {
  res.send('Hello Secure World!')
})

// 创建 HTTPS 服务器
const httpsServer = https.createServer(credentials, app)

const port = 3000 // 你可以选择任何你喜欢的端口

httpsServer.listen(port, () => {
  console.log(`HTTPS server listening on port ${port}`)
})
```

**代码解释：**

- `require('express')`: 导入 Express 模块。
- `require('https')`: 导入 Node.js 的 HTTPS 模块。
- `require('fs')`: 导入 Node.js 的文件系统模块。
- `fs.readFileSync('key.pem', 'utf8')`: 从 `key.pem` 文件中读取私钥。
- `fs.readFileSync('cert.pem', 'utf8')`: 从 `cert.pem` 文件中读取证书。
- `credentials`: 一个包含私钥和证书的对象，用于配置 HTTPS 服务器。
- `app.get('/', ...)`: 定义一个简单的路由，当访问根路径时返回 "Hello Secure World!"。
- `https.createServer(credentials, app)`: 使用证书和 Express 应用创建一个 HTTPS 服务器。
- `httpsServer.listen(port, ...)`: 启动 HTTPS 服务器并监听指定的端口。

**4. 运行应用**

```bash
node app.js
```

**5. 测试应用**

在你的浏览器中访问 `https://localhost:3000` (如果你的服务器域名不是 `localhost`，请替换成你的域名)。

**重要的注意事项：**

- **自签名证书不受信任：** 你的浏览器会显示一个警告，因为自签名证书不受任何受信任的证书颁发机构 (CA) 的签名。 你需要手动信任这个证书才能正常访问网站。 具体方法取决于你的浏览器：
  - **Chrome:** 点击 "高级" 并选择 "继续访问 localhost (不安全)"。
  - **Firefox:** 点击 "高级" 并选择 "接受风险并继续"。
- **仅用于开发环境：** 自签名证书不适合用于生产环境。 你应该从一个受信任的 CA 获取证书。
- **证书有效期：** 在生成证书时，`-days 365` 指定了证书的有效期为 365 天。 你可以根据需要调整这个值。
- **安全性：** 请务必妥善保管你的私钥 `key.pem`，不要泄露给任何人。

**如何信任自签名证书 (仅用于开发):**

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
5.  找到你添加的证书 (通常显示为你的Common Name)。
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

在完成上述操作后，重新启动浏览器，访问 `https://localhost:3000`，你应该不会再看到安全警告了。

**总结：**

通过这些步骤，你可以成功地在 Express 应用中使用自签名证书启动 HTTPS 服务。 记住，自签名证书仅适用于开发和测试环境，生产环境应该使用受信任的 CA 颁发的证书。
