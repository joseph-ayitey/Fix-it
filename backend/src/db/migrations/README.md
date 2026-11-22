# Migrations

Changes to the schema of a database that already exists. Version 1 is `../schema.sql`;
files here continue from 002.

To change the schema:

1. Add a file named with the next number and a short description, for example
   `002_add_repair_cost.sql`:
   ```sql
   ALTER TABLE issues ADD COLUMN repair_cost_cents integer CHECK (repair_cost_cents >= 0);
   ```
2. Update the code that uses it (in `src/models/`), and add a test.
3. Restart the API (`npm run dev` restarts on its own). The log shows
   `Database migrated: 2 add_repair_cost`.

Rules:
- Never edit, rename or delete a migration that has already run anywhere. Databases that
  ran it won't run it again, so your change would only reach some of them. Write a new
  migration instead.
- Don't edit `schema.sql` for an existing database; it only runs on an empty one.
- Each file runs in a transaction. If it fails, nothing in it is applied and the API
  refuses to start, so read the error, fix the file, and restart.

`npm run db:status` shows which versions a database has.
