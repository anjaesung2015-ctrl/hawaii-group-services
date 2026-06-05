-- 008: 농구a를 칸1만으로(왼쪽). 가운데(테2·배2)는 농구b만 막도록. 농구a=1, 농구b=23.
UPDATE court SET floor_cols='1' WHERE id = 6;
INSERT INTO schema_version (version) VALUES (8);
