-- 005: 농구 코트명을 정식 명칭(Сагсан бөмбөг)으로
UPDATE court SET name_mn = 'Сагсан бөмбөг А' WHERE id = 6;
UPDATE court SET name_mn = 'Сагсан бөмбөг Б' WHERE id = 7;
INSERT INTO schema_version (version) VALUES (5);
