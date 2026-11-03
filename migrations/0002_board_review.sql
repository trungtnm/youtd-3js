-- Weekly boards: spot runs that end with another player's tower layout, and let the
-- owner hide entries after reviewing them.
ALTER TABLE runs ADD COLUMN layout_hash TEXT;  -- SHA-256 of the towers standing at the end of a verified weekly run
CREATE INDEX runs_board_layout ON runs(board_key, layout_hash);
ALTER TABLE board ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;  -- 1: left off the public board
ALTER TABLE board ADD COLUMN note TEXT;                          -- why it was hidden
