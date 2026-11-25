#!/usr/bin/env python3
"""hawaii-ops 의 data.json → staff-manager 의 jobs.json (직무별 매일 체크리스트).

사용법:  python tools/build-jobs.py 경로/data.json
업무표(엑셀)와 업무보고 앱이 같은 내용을 쓰도록, data.json 을 고친 뒤 이걸 다시 돌리면 된다.
"""
import json
import sys
from pathlib import Path

DAYS = ["월", "화", "수", "목", "금", "토"]
SITE_MN = {"피트니스": "Фитнес", "센터": "Спорт төв", "전체": ""}
ROLE_MN = {"총매니저": "Ерөнхий менежер", "매니저": "Менежер", "리셉션": "Ресепшн", "트레이너": "Дасгалжуулагч",
           "청소": "Цэвэрлэгээ", "카운터": "Касс", "코치": "Теннисний дасгалжуулагч",
           "시설": "Байгууламж"}
WHEN_MN = {"매일": "Өдөр бүр", "출근 15분 내": "Ирснээс 15 мин", "근무 중": "Ажлын үеэр",
           "마감": "Хаахад", "3시간마다": "3 цаг тутам", "2시간마다": "2 цаг тутам",
           "30분마다": "30 мин тутам", "14시까지": "14:00 хүртэл", "즉시": "Шууд",
           "하루 2번": "Өдөрт 2 удаа", "청소할 때마다": "Цэвэрлэх бүрт", "레슨 후": "Хичээлийн дараа",
           "수시": "Байнга", "요청 시": "Хүсэлтээр", "레슨 10분 전": "Хичээлээс 10 мин өмнө",
           "레슨 시작": "Хичээл эхлэхэд", "매월 첫 월": "Сарын эхний Да",
           "월": "Да", "화": "Мя", "수": "Лх", "목": "Пү", "금": "Ба", "토": "Бя"}


def main():
    src = Path(sys.argv[1])
    d = json.loads(src.read_text(encoding="utf-8"))
    jobs = []

    # 매니저: manager_tasks 중 공통 + 자기 사업장 것
    mt = d["manager_tasks"]["rows"]   # [요일, 매니저, 업무, Ажил, 결과물, 예시]
    for site, key in (("피트니스", "피트-매니저"), ("센터", "센터-매니저")):
        tasks = [{"when": r[0], "ko": r[2], "mn": r[3], "out": r[4]}
                 for r in mt if r[1] in ("공통", site)]
        jobs.append({"key": key, "site": site, "role": "매니저", "tasks": tasks})

    # 총매니저: 두 사업장 공통 매니저 업무 (매일·요일 '공통')
    tasks = [{"when": r[0], "ko": r[2], "mn": r[3], "out": r[4]} for r in mt if r[1] == "공통"]
    jobs.append({"key": "총매니저", "site": "전체", "role": "총매니저", "tasks": tasks})

    for r in d["roles"]:
        tasks = [{"when": t[0], "ko": t[1], "mn": t[2]} for t in r["tasks"]]
        jobs.append({"key": r["sheet"], "site": r["site"], "role": r["role"], "tasks": tasks})

    for j in jobs:
        j["label_ko"] = j["role"] if j["site"] == "전체" else f'{j["site"]} {j["role"]}'
        j["label_mn"] = f'{SITE_MN[j["site"]]} {ROLE_MN.get(j["role"], j["role"])}'.strip()
        for t in j["tasks"]:
            t["when_mn"] = WHEN_MN.get(t["when"], t["when"])

    # 피트니스 먼저, 매니저 먼저
    order = {"전체": -1, "피트니스": 0, "센터": 1}
    jobs.sort(key=lambda j: (order[j["site"]], j["role"] != "매니저"))
    out = Path(__file__).resolve().parent.parent / "jobs.json"
    out.write_text(json.dumps({"days": DAYS, "jobs": jobs}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"jobs.json: 직무 {len(jobs)}개, 업무 {sum(len(j['tasks']) for j in jobs)}줄")


if __name__ == "__main__":
    main()
