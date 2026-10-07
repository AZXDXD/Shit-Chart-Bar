-- Review before running. This file has NOT been deployed by the frontend update.
-- Add missing values only; preserve all charts and existing enum values.
ALTER TYPE public.difficulty_type ADD VALUE IF NOT EXISTS 'BASIC' BEFORE 'EXPERT';
ALTER TYPE public.difficulty_type ADD VALUE IF NOT EXISTS 'ADVANCED' BEFORE 'EXPERT';
