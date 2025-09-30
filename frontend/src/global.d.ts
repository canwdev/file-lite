import type { Message } from 'element-plus'
import type { SFCInstallWithContext } from 'element-plus/es/utils'

declare global {
  interface Window {
    $message: SFCInstallWithContext<Message>
    $dialog: SFCInstallWithContext<ElMessageBox>
    $logout: () => void
  }
}
