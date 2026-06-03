-- 004: 몽골어 코트 이름 자연스럽게 다듬기 (name_ko/zone 등은 변경 없음)
UPDATE court SET name_mn = 'Теннис №1'       WHERE id = 1;
UPDATE court SET name_mn = 'Теннис №2'       WHERE id = 2;
UPDATE court SET name_mn = 'Теннис №3'       WHERE id = 3;
UPDATE court SET name_mn = '2 давхрын корт'  WHERE id = 4;
UPDATE court SET name_mn = 'Гадаа корт'      WHERE id = 5;
UPDATE court SET name_mn = 'Сагс А'          WHERE id = 6;
UPDATE court SET name_mn = 'Сагс Б'          WHERE id = 7;
UPDATE court SET name_mn = 'Волейбол №1'     WHERE id = 8;
UPDATE court SET name_mn = 'Волейбол №2'     WHERE id = 9;
UPDATE court SET name_mn = 'Волейбол №3'     WHERE id = 10;
INSERT INTO schema_version (version) VALUES (4);
