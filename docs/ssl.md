# Enable HTTPS with a self-signed certificate

[中文](./zh-CN/ssl.md) | English

File Lite (Go backend) turns on HTTPS through the `sslKey` and `sslCert` fields of `config.json` in the data directory. When both are non-empty the server starts with HTTPS; otherwise it starts with HTTP. Paths are relative to the data directory (default `<cwd>/file-lite/`, overridable with `--data-dir` or `FILE_LITE_DATA_BASE_DIR`).

## 1. Generate a self-signed certificate (skip if you already have one)

**Option 1: generate it when the config is first created.** The Go standard library does this; OpenSSL or any other external command is not required.

```bash
./file-lite-go --create-config --with-tls
```

This writes `key.pem` (private key) and `cert.pem` (certificate) into the data directory and sets `sslKey` / `sslCert` in `config.json`. The certificate:

- Has subject `CN=file-lite`, an RSA 2048-bit key, and a validity of 365 days. `CN` is only the certificate's name and is not used for hostname checks.
- Always includes `DNS:localhost`, `IP:127.0.0.1` and `IP:::1` in `subjectAltName` (SAN). When `--tls-host` is not set, the detected addresses of the local interfaces are added as well (link-local addresses are skipped). Current browsers and Go check the hostname against the SAN only.

To add other names or addresses, repeat `--tls-host`:

```bash
./file-lite-go --create-config --with-tls \
  --tls-host app.local --tls-host 192.168.1.10
```

- `--tls-host <host>` appends a DNS name or an IP to the SAN. It may be repeated. IPv6 may be written as `[::1]` or `::1`.
- **Once `--tls-host` is set, local IPs are no longer scanned.** The SAN is only `localhost`, the loopback addresses, and the hosts you named, so addresses from virtual interfaces (docker0, veth, and so on) stay out. Write a local IP explicitly if you want it included.

Generating or reusing a certificate prints the full certificate details:

```
tls cert written: key.pem, cert.pem
  subject:  CN=file-lite
  pubkey:   RSA 2048-bit
  sig:      SHA256-RSA
  serial:   219414278114519540679476560263082189088
  validity: 2026-09-10 ~ 2027-09-10 (365 days left)
  sha256:   FB:0F:8B:AC:A5:1E:EB:90:56:B2:E2:A0:75:CA:52:55:D7:F5:7C:19:6F:D8:4E:7A:78:CF:D4:20:BB:70:FE:D5
  san:      localhost, app.local, 127.0.0.1, ::1, 192.168.1.10
  source:   defaults + --tls-host (local IP scan skipped)
  cert:     /path/to/file-lite/cert.pem
  key:      /path/to/file-lite/key.pem
```

If both `key.pem` and `cert.pem` already exist, generation is skipped and the existing files are reused (the printout is then the existing certificate). If a `--tls-host` you passed is not covered by that certificate, an extra `warning:` line is printed; delete the two files as it says and generate them again.

**Option 2: generate it yourself with OpenSSL**

```bash
# Change to the data directory
cd file-lite

openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
```

> On Windows, run the command above in Git Bash. Git for Windows has to be installed first.

The command writes two files:

- **key.pem**: the private key
- **cert.pem**: the certificate

OpenSSL then asks for a country code, state, city, organization, organizational unit, common name (domain) and email address. Fill those in as you like. `Common Name (e.g. server FQDN or YOUR name) []:` matters: usually the server's domain name, or `localhost` for local development.

## 2. Enable it in the config

Edit `file-lite/config.json` and set `sslKey` and `sslCert` (paths relative to the data directory):

```json
{
  "sslKey": "key.pem",
  "sslCert": "cert.pem"
}
```

## 3. Restart the server

After a restart the console prints `HTTPS enabled` and the links use `https://`.

## 4. Trust the self-signed certificate (development only)

How you trust it depends on the operating system and the browser.

**Windows:**

1.  Double-click `cert.pem`.
2.  Choose "Install Certificate".
3.  Choose "Local Machine" and click "Next".
4.  Choose "Place all certificates in the following store" and click "Browse".
5.  Choose "Trusted Root Certification Authorities" and click "OK".
6.  Click "Next" and "Finish".
7.  If a security warning appears, click "Yes".

**macOS:**

1.  Double-click `cert.pem`.
2.  Keychain Access opens.
3.  In the Keychain menu, choose "System".
4.  Click "Add".
5.  Find the certificate you added (it is usually shown as your Common Name).
6.  Double-click the certificate.
7.  Under Trust, set "When using this certificate" to "Always Trust".
8.  Enter your administrator password.

**Linux (Ubuntu):**

1.  Copy `cert.pem` into `/usr/local/share/ca-certificates/`:

    ```bash
    sudo cp cert.pem /usr/local/share/ca-certificates/my-app.crt
    ```

2.  Update the trust store:

    ```bash
    sudo update-ca-certificates
    ```

Restart the browser. `https://localhost:<port>` should no longer show a security warning.

## Notes

- **A self-signed certificate is not trusted.** The browser warns until you trust it by hand.
- **Development only.** A self-signed certificate is not appropriate for production. Production should use a certificate from a trusted CA.
- **Validity.** The generated certificate lasts 365 days. An OpenSSL certificate lasts however many days `-days` sets (365 above). Either can be changed. When it expires, regenerate `key.pem` and `cert.pem` and restart.
- **Keep the private key (`key.pem`) private.** Do not give it to anyone.
