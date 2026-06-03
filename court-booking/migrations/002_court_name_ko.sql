-- 002: 코트 이름 이중언어(name_mn 몽골어 + name_ko 한국어).
-- 기존 데이터의 name_mn에는 한국어가 들어있었음 → 한국어를 name_ko로 옮기고
-- name_mn은 몽골어로 교체. (손님 화면 몽골어 디폴트, KO 토글 시 한국어 표시)
ALTER TABLE court ADD COLUMN name_ko TEXT;

-- 1) 현재 name_mn(한국어)을 name_ko로 백필
UPDATE court SET name_ko = name_mn WHERE name_ko IS NULL;

-- 2) name_mn을 몽골어로 교체 (id 기준 — 라이브 10코트 고정)
UPDATE court SET name_mn = 'Теннис 1'     WHERE id = 1;
UPDATE court SET name_mn = 'Теннис 2'     WHERE id = 2;
UPDATE court SET name_mn = 'Теннис 3'     WHERE id = 3;
UPDATE court SET name_mn = '2-р давхар'   WHERE id = 4;
UPDATE court SET name_mn = 'Гадаа талбай' WHERE id = 5;
UPDATE court SET name_mn = 'Сагс A'       WHERE id = 6;
UPDATE court SET name_mn = 'Сагс B'       WHERE id = 7;
UPDATE court SET name_mn = 'Волейбол 1'   WHERE id = 8;
UPDATE court SET name_mn = 'Волейбол 2'   WHERE id = 9;
UPDATE court SET name_mn = 'Волейбол 3'   WHERE id = 10;

INSERT INTO schema_version (version) VALUES (2);
