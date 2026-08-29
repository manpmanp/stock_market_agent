-- Adds a growth/defensive/blend classification to rankings, and the two
-- extra fundamentals/technical fields the classifier needs. See
-- src/scoring/score.ts classifyStyle() for the (documented, adjustable)
-- rule this drives.

ALTER TABLE rankings ADD COLUMN style TEXT; -- 'growth' | 'defensive' | 'blend' | NULL
