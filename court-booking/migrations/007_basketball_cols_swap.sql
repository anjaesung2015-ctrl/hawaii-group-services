-- 007: 농구 a/b 칸 스왑. 농구a=12(왼쪽+가운데), 농구b=23(가운데+오른쪽)
UPDATE court SET floor_cols='12' WHERE id = 6;
UPDATE court SET floor_cols='23' WHERE id = 7;
INSERT INTO schema_version (version) VALUES (7);
