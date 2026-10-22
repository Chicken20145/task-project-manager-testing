export const PASSWORD_MESSAGE = 'Mật khẩu cần 6–128 ký tự, có ít nhất một số và một ký tự đặc biệt (ví dụ @).';

export function validNewPassword(value) {
  return typeof value === 'string' && [...value].length >= 6 && [...value].length <= 128 &&
    !/[\u0000\uD800-\uDFFF]/u.test(value) && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value);
}
