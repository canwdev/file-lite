/**
 * 管理IP失败尝试和封禁状态的类
 */
export class IPRateLimiter {
  // 使用 private 属性封装内部状态
  private readonly failureTracker = new Map<string, number>()
  private readonly bannedIPs = new Map<string, number>()
  private readonly maxAttempts: number
  private readonly banDurationMs: number

  constructor(options: { maxAttempts: number, banDurationMs: number }) {
    this.maxAttempts = options.maxAttempts
    this.banDurationMs = options.banDurationMs
  }

  /**
   * 检查一个IP的当前状态，并处理自动解封
   * @param ip 要检查的IP地址
   * @returns 返回一个对象，指明IP是否被封禁以及剩余时间
   */
  public check(ip: string): { isBanned: boolean, timeLeft?: number } {
    const unbanTime = this.bannedIPs.get(ip)

    // 如果存在解封时间戳
    if (unbanTime) {
      // 检查封禁是否已过期
      if (Date.now() > unbanTime) {
        this.bannedIPs.delete(ip) // 解封
        this.failureTracker.delete(ip) // 清除失败记录
        return { isBanned: false }
      }

      // 仍在封禁期
      const timeLeft = Math.ceil((unbanTime - Date.now()) / 1000 / 60)
      return { isBanned: true, timeLeft }
    }

    return { isBanned: false }
  }

  /**
   * 记录一次失败的尝试。如果达到阈值，则自动封禁IP。
   * @param ip 失败尝试的IP地址
   */
  public recordFailure(ip: string): void {
    const currentFailures = (this.failureTracker.get(ip) || 0) + 1
    this.failureTracker.set(ip, currentFailures)

    if (currentFailures > this.maxAttempts) {
      this.ban(ip)
    }
  }

  /**
   * 记录一次成功的尝试，清除该IP的失败记录。
   * @param ip 成功尝试的IP地址
   */
  public recordSuccess(ip: string): void {
    if (this.failureTracker.has(ip)) {
      this.failureTracker.delete(ip)
    }
  }

  /**
   * 封禁一个IP
   * @param ip 要封禁的IP地址
   */
  private ban(ip: string): void {
    console.warn(`[AuthLimiter] Banning IP ${ip} for ${this.banDurationMs / 60000} minutes.`)
    this.bannedIPs.set(ip, Date.now() + this.banDurationMs)
    // 封禁后从失败记录中移除，节省内存
    this.failureTracker.delete(ip)
  }
}
