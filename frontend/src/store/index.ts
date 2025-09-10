import {useStorage} from '@vueuse/core'

export const authToken = useStorage('file_lite_auth_password', '')
