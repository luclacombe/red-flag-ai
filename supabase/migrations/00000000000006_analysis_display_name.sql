-- Add display_name to analyses for rerun naming (overrides document filename when set)
ALTER TABLE analyses ADD COLUMN display_name TEXT DEFAULT NULL;
