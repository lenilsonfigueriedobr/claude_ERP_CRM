import { hashPassword, generatePassword, passwordProblem } from '../lib/security.js';

// Cria o primeiro administrador quando o banco está vazio.
export function ensureAdmin(db, config, log = console.log) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count) return null;
  let password = config.admin.password;
  const generated = !password;
  if (generated) password = generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD inválida: ${problem}`);
  db.prepare("INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES (?, ?, 'admin', ?, ?)")
    .run(config.admin.name, config.admin.email.toLowerCase(), hashPassword(password), generated ? 1 : 0);
  if (generated) {
    log('\n============================================================');
    log(' Administrador criado. Anote a senha, ela não será exibida de novo.');
    log(` E-mail: ${config.admin.email}`);
    log(` Senha:  ${password}`);
    log('============================================================\n');
  }
  return password;
}
