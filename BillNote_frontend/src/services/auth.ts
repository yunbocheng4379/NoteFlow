import request from '@/utils/request'

export interface LoginParams {
  account: string
  password: string
}

export interface RegisterParams {
  username: string
  email: string
  password: string
  confirm_password: string
  invite_code?: string
}

export interface UserInfo {
  id: number
  username: string
  email: string
  phone?: string | null
  avatar?: string
  is_admin?: number
}

export interface AuthResult {
  token: string
  user: UserInfo
}

export type TargetType = 'email' | 'phone'
export type CodePurpose = 'login' | 'bind' | 'bind_email' | 'verify_phone' | 'verify_email' | 'reset_password'

export interface SendCodeParams {
  target?: string  // verify_phone/verify_email 由服务端从登录用户身上取值, 无需传
  target_type: TargetType
  purpose: CodePurpose
}

export interface LoginByCodeParams {
  target: string
  target_type: TargetType
  code: string
}

export interface ResetPasswordParams {
  target: string
  target_type: TargetType
  code: string
  new_password: string
}

export interface BindPhoneParams {
  phone: string
  code: string
  ticket?: string  // 换绑(已有手机号)时必填, 来自 verifyContact
}

export interface BindEmailParams {
  email: string
  code: string
  ticket: string  // 来自 verifyContact
}

export interface VerifyContactParams {
  target_type: TargetType
  code: string
}

// 认证相关错误码（与后端 StatusCode 保持一致）
export const AuthErrorCode = {
  ACCOUNT_NOT_FOUND: 40401,
  PASSWORD_INCORRECT: 40101,
  ACCOUNT_DISABLED: 40301,
  USERNAME_EXISTS: 40901,
  EMAIL_EXISTS: 40902,
  TARGET_NOT_FOUND: 40402,
  PHONE_EXISTS: 40903,
  CODE_INVALID: 40103,
  CODE_EXPIRED: 40104,
  RATE_LIMITED: 42901,
  SEND_CODE_FAILED: 50001,
  TICKET_INVALID: 40105,
} as const

export const authApi = {
  login: (params: LoginParams) =>
    request.post<any, AuthResult>('/auth/login', params, { suppressToast: true }),

  register: (params: RegisterParams) =>
    request.post<any, AuthResult>('/auth/register', params, { suppressToast: true }),

  me: () => request.get<any, UserInfo>('/auth/me'),

  sendCode: (params: SendCodeParams) =>
    request.post<any, { sent: boolean }>('/auth/send-code', params, { suppressToast: true }),

  loginByCode: (params: LoginByCodeParams) =>
    request.post<any, AuthResult>('/auth/login-by-code', params, { suppressToast: true }),

  resetPassword: (params: ResetPasswordParams) =>
    request.post<any, { reset: boolean }>('/auth/reset-password', params, { suppressToast: true }),

  bindPhone: (params: BindPhoneParams) =>
    request.post<any, { phone: string }>('/auth/bind-phone', params, { suppressToast: true }),

  bindEmail: (params: BindEmailParams) =>
    request.post<any, { email: string }>('/auth/bind-email', params, { suppressToast: true }),

  verifyContact: (params: VerifyContactParams) =>
    request.post<any, { ticket: string }>('/auth/verify-contact', params, { suppressToast: true }),
}
