-- 003: 1층 물리적 구역(zone) 컬럼. L(왼쪽)/M(중간)/R(오른쪽), 2층·야외는 NULL.
-- LEFT: 테니스1(1)·농구a(6)·배구1(8) / MIDDLE: 테니스2(2)·배구2(9) / RIGHT: 테니스3(3)·농구b(7)·배구3(10)
ALTER TABLE court ADD COLUMN zone TEXT;
UPDATE court SET zone='L' WHERE id IN (1,6,8);
UPDATE court SET zone='M' WHERE id IN (2,9);
UPDATE court SET zone='R' WHERE id IN (3,7,10);
INSERT INTO schema_version (version) VALUES (3);
