import { Pool } from 'pg';
import { createApp } from './app';

const url = process.env.DATABASE_URL;
const secret = process.env.SUPABASE_JWT_SECRET;
if (!url || !secret) {
  // eslint-disable-next-line no-console
  console.error('Defina DATABASE_URL e SUPABASE_JWT_SECRET.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
const port = Number(process.env.PORT ?? 3000);
createApp({ pool, jwtSecret: secret }).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`docsholder API em :${port}`);
});
