-- Set once the player picks a display name (or keeps the generated one). New signed-in
-- accounts without it are asked to choose a name after signing in.
ALTER TABLE users ADD COLUMN named INTEGER NOT NULL DEFAULT 0;
