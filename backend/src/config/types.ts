export interface IConfig {
  // 监听地址，如果传入 127.0.0.1 则不允许外部设备访问，默认 '0.0.0.0'
  host: string
  // 监听端口，默认 '3100'
  port: string
  // 是否开启无密码模式，开启后将不会检查密码。默认 false
  noAuth: boolean
  // 密码，留空则每次启动随机生成。默认 ''
  password: string
  // 安全路径(支持绝对路径和相对路径)，如果访问范围超出该目录会报错，设置为空字符串不检查。默认 ''
  safeBaseDir: string
  // 是否开启日志。默认 true
  enableLog: boolean
  // 传入以下两个参数来开启https
  // 生成证书(Windows 可以用 git bash 生成)：openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
  sslKey: string
  sslCert: string
}
export function getInitConfig(): IConfig {
  return {
    host: '',
    port: '',
    noAuth: false,
    password: '',
    safeBaseDir: './',
    enableLog: true,
    sslKey: '',
    sslCert: '',
  }
}
export interface InternalConfig {
  // JSON 读取的配置
  config?: IConfig
  // 配置是否初始化
  configInitialized: boolean
  // 配置文件路径
  configFilePath: string
  // 数据基础文件夹
  dataBaseDir: string
  // 最终的认证 token
  authToken: string
  // 安全的绝对路径，如果访问范围超出该目录会报错，设置为空字符串不检查
  safeBaseDir: string
}
