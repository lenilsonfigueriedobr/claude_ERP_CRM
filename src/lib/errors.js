export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, details);
export const unauthorized = (msg = 'Faça login para continuar.') => new AppError(401, msg);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError(403, msg);
export const notFound = (msg = 'Registro não encontrado.') => new AppError(404, msg);
export const conflict = (msg, details) => new AppError(409, msg, details);
