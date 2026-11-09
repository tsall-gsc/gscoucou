// The Supabase client.
// main.js calls connect() once at start-up; every screen then imports `db` and uses it
// (for example: db.from('students').select('*')). `db` is a live binding, so screens
// always see the connected client.
export let db = null;

export function connect(url, key) {
  db = supabase.createClient(url, key);   // `supabase` comes from the library loaded in index.html
  return db;
}
