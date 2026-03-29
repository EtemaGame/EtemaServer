import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env o la configuracion del entorno.`);
  }

  return value;
}
