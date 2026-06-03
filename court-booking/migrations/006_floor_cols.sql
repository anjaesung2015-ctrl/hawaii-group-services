-- 006: 1층 칸(floor_cols) 모델. 왼→오 1·2·3. 농구는 2칸(농구a=23, 농구b=12).
ALTER TABLE court ADD COLUMN floor_cols TEXT;
UPDATE court SET floor_cols='1'  WHERE id IN (1,8);
UPDATE court SET floor_cols='2'  WHERE id IN (2,9);
UPDATE court SET floor_cols='3'  WHERE id IN (3,10);
UPDATE court SET floor_cols='23' WHERE id = 6;
UPDATE court SET floor_cols='12' WHERE id = 7;
INSERT INTO schema_version (version) VALUES (6);
